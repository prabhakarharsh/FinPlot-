// server/chat/agent.js
// Agent Orchestration Loop for Munim AI Copilot
// Manages multi-turn tool calling, safety verification, progress streaming, and persistence

import { streamChat } from './llm.js';
import { TOOL_DEFINITIONS, executeTool } from './tools.js';
import { buildSystemPrompt, checkInputGuard, wrapToolOutput } from './prompt.js';
import { verifyAnswer, generateSafeFallback } from './verify.js';

const MAX_ITERATIONS = parseInt(process.env.CHAT_MAX_ITERATIONS || '6', 10);
const HISTORY_LIMIT = parseInt(process.env.CHAT_HISTORY_LIMIT || '12', 10);
const TOOL_TIMEOUT_MS = 30000;

/**
 * Friendly status mapping for tools
 */
function getFriendlyToolStatus(toolName, args = {}) {
  switch (toolName) {
    case 'get_data_overview':
      return 'Checking your transaction history range...';
    case 'get_summary':
      return 'Calculating income, spending, and savings rate...';
    case 'get_category_breakdown':
      return 'Analyzing your category breakdown...';
    case 'compare_periods':
      return 'Comparing cash flows across periods...';
    case 'top_merchants':
      return args.category ? `Finding top merchants in ${args.category}...` : 'Finding your top merchants by expenditure...';
    case 'search_transactions':
      return args.query ? `Searching records for "${args.query}"...` : 'Filtering transaction records...';
    case 'list_recurring':
      return 'Scanning subscriptions and regular payments...';
    case 'list_flags':
      return 'Checking items flagged for review...';
    case 'get_goal_progress':
      return 'Calculating savings goal progress...';
    case 'run_scenario':
      return 'Running what-if financial scenario projections...';
    case 'propose_action':
      return 'Preparing an action proposal for your review...';
    default:
      return 'Consulting financial engine...';
  }
}

/**
 * Run Munim Agent
 * Generator that yields SSE event payloads:
 * - { event: 'status', data: { message: '...' } }
 * - { event: 'text', data: { delta: '...' } }
 * - { event: 'sources', data: [...] }
 * - { event: 'proposal', data: {...} }
 * - { event: 'verified', data: { verified: boolean } }
 * - { event: 'done', data: { messageId, ... } }
 * - { event: 'error', data: { error: '...' } }
 */
export async function* runMunimAgent({
  userMessage,
  history = [],
  context = {},
  signal
}) {
  // 1. Pre-LLM Input Guard Check
  const guard = checkInputGuard(userMessage);
  if (!guard.ok) {
    yield { event: 'text', data: { delta: guard.refusal } };
    yield { event: 'verified', data: { verified: true } };
    yield {
      event: 'done',
      data: {
        sources: [],
        tools_used: [],
        verified: true,
        tokens_in: 10,
        tokens_out: 25,
        proposals: []
      }
    };
    return;
  }

  // 2. Prepare Conversation Context & History
  const recentHistory = (history || []).slice(-HISTORY_LIMIT);
  const systemPrompt = buildSystemPrompt(context);

  const conversationMessages = [
    ...recentHistory.map(h => ({ role: h.role, content: h.content })),
    { role: 'user', content: userMessage }
  ];

  let iterations = 0;
  const toolResultsThisTurn = [];
  const toolsUsedMeta = [];
  const turnProposals = [];
  const turnMemoCache = new Map(); // Turn-level memoization for identical tool calls
  let totalTokensIn = 0;
  let totalTokensOut = 0;
  let finalDraftText = '';
  const startTime = Date.now();

  // 3. Multi-turn Agent Execution Loop
  while (iterations < MAX_ITERATIONS) {
    iterations++;

    // Check total tool budget timeout (30 seconds)
    if (Date.now() - startTime > TOOL_TIMEOUT_MS) {
      yield { event: 'status', data: { message: 'Finishing summary with current results...' } };
      break;
    }

    if (signal?.aborted) {
      yield { event: 'error', data: { error: 'Request was cancelled by user.' } };
      return;
    }

    const generator = streamChat({
      system: systemPrompt,
      messages: conversationMessages,
      tools: TOOL_DEFINITIONS,
      signal
    });

    const pendingToolCalls = [];
    let currentIterationText = '';

    for await (const chunk of generator) {
      if (signal?.aborted) return;

      if (chunk.type === 'text_delta') {
        currentIterationText += chunk.delta;
        yield { event: 'text', data: { delta: chunk.delta } };
      } else if (chunk.type === 'tool_call') {
        pendingToolCalls.push(chunk);
      } else if (chunk.type === 'usage') {
        totalTokensIn += chunk.tokens_in || 0;
        totalTokensOut += chunk.tokens_out || 0;
      }
    }

    if (currentIterationText) {
      finalDraftText += currentIterationText;
    }

    // If no tools were called, the model is delivering the final answer
    if (pendingToolCalls.length === 0) {
      break;
    }

    // Record assistant's tool call turn with all tool calls from this step
    conversationMessages.push({
      role: 'assistant',
      content: currentIterationText || null,
      tool_calls: pendingToolCalls.map(tc => ({
        id: tc.id,
        name: tc.name,
        args: tc.args,
        thoughtSignature: tc.thoughtSignature
      }))
    });

    // Execute tool calls
    for (const tc of pendingToolCalls) {
      if (signal?.aborted) return;

      yield { event: 'status', data: { message: getFriendlyToolStatus(tc.name, tc.args) } };

      const cacheKey = `${tc.name}:${JSON.stringify(tc.args || {})}`;
      let resultEnvelope;
      const tStart = Date.now();

      if (turnMemoCache.has(cacheKey)) {
        resultEnvelope = turnMemoCache.get(cacheKey);
      } else {
        resultEnvelope = await executeTool(tc.name, tc.args, context);
        turnMemoCache.set(cacheKey, resultEnvelope);
      }

      const durationMs = Date.now() - tStart;
      toolResultsThisTurn.push(resultEnvelope);
      toolsUsedMeta.push({ name: tc.name, args: tc.args, duration_ms: durationMs });

      // If tool produced a proposal, record and emit proposal event
      if (tc.name === 'propose_action' && resultEnvelope.ok && resultEnvelope.data?.proposal_id) {
        turnProposals.push(resultEnvelope.data);
        yield { event: 'proposal', data: resultEnvelope.data };
      }

      // Record tool result
      conversationMessages.push({
        role: 'tool',
        name: tc.name,
        tool_call_id: tc.id,
        content: wrapToolOutput(tc.name, resultEnvelope)
      });
    }
  }

  // 4. Answer Verification Layer (Phase 5)
  let verification = verifyAnswer({
    answerText: finalDraftText,
    toolResults: toolResultsThisTurn,
    userQuery: userMessage,
    context
  });

  // If verification failed, retry ONCE with corrective prompt
  if (!verification.verified && toolResultsThisTurn.length > 0) {
    yield { event: 'status', data: { message: 'Double-checking numbers with financial engine...' } };

    const correctivePrompt = verification.isBanned
      ? `Your previous draft contained prohibited terminology: "${verification.bannedTerm}". Please rephrase with neutral wording ("flagged for review") and state only facts from tool results.`
      : `Your previous response contained unverified figures: ${verification.unverifiedNumbers.join(', ')}. Please remove or replace them strictly using values from the tool results. Do not estimate or do arithmetic.`;

    conversationMessages.push({ role: 'assistant', content: finalDraftText });
    conversationMessages.push({ role: 'user', content: correctivePrompt });

    let retryText = '';
    const retryGen = streamChat({
      system: systemPrompt,
      messages: conversationMessages,
      tools: TOOL_DEFINITIONS,
      signal
    });

    for await (const chunk of retryGen) {
      if (chunk.type === 'text_delta') {
        retryText += chunk.delta;
      } else if (chunk.type === 'usage') {
        totalTokensIn += chunk.tokens_in || 0;
        totalTokensOut += chunk.tokens_out || 0;
      }
    }

    if (retryText) {
      const retryVerification = verifyAnswer({
        answerText: retryText,
        toolResults: toolResultsThisTurn,
        userQuery: userMessage,
        context
      });

      if (retryVerification.verified) {
        finalDraftText = retryText;
        verification = retryVerification;
      } else if (verification.isBanned || !finalDraftText) {
        finalDraftText = generateSafeFallback(toolResultsThisTurn);
        verification = { verified: true, sanitizedAnswer: finalDraftText };
      } else {
        // Keep conversational/freestyle response with soft warning
        finalDraftText = retryText || finalDraftText;
        verification = { ...retryVerification, sanitizedAnswer: finalDraftText };
      }
    } else if (verification.isBanned || !finalDraftText) {
      finalDraftText = generateSafeFallback(toolResultsThisTurn);
      verification = { verified: true, sanitizedAnswer: finalDraftText };
    } else {
      verification = { ...verification, sanitizedAnswer: finalDraftText };
    }
  }

  // Consolidate verified sources
  const allSources = [];
  const seenIds = new Set();
  for (const tr of toolResultsThisTurn) {
    if (Array.isArray(tr.sources)) {
      for (const s of tr.sources) {
        if (!seenIds.has(s.id)) {
          seenIds.add(s.id);
          allSources.push(s);
        }
      }
    }
    if (tr.calc_id && !seenIds.has(tr.calc_id)) {
      seenIds.add(tr.calc_id);
      allSources.push({ type: 'calc', id: tr.calc_id, label: tr.calc_id, assumptions: tr.assumptions });
    }
  }

  // 5. Emit final events
  yield { event: 'sources', data: allSources };
  yield { event: 'verified', data: { verified: verification.verified } };
  yield {
    event: 'done',
    data: {
      content: verification.sanitizedAnswer || finalDraftText,
      sources: allSources,
      tools_used: toolsUsedMeta,
      verified: verification.verified,
      tokens_in: totalTokensIn,
      tokens_out: totalTokensOut,
      proposals: turnProposals
    }
  };
}
