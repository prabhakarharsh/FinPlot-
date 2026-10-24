// server/chat/llm.js
// Provider-agnostic LLM Adapter for Munim AI Copilot
// Supports Gemini, Anthropic, and deterministic Mock provider

import { TOOL_DEFINITIONS } from './tools.js';

const DEFAULT_TIMEOUT_MS = 60000;

function getZodShape(zodSchema) {
  if (!zodSchema) return {};
  if (typeof zodSchema._def?.shape === 'function') return zodSchema._def.shape();
  if (zodSchema._def?.shape && typeof zodSchema._def.shape === 'object') return zodSchema._def.shape;
  if (zodSchema.shape && typeof zodSchema.shape === 'object') return zodSchema.shape;
  return {};
}

/**
 * Format tools for Gemini API
 */
function formatToolsForGemini(tools = []) {
  if (!tools.length) return undefined;
  return [{
    functionDeclarations: tools.map(t => {
      const zodShape = getZodShape(t.parameters);
      const properties = {};
      const required = [];

      for (const [key, val] of Object.entries(zodShape)) {
        const typeName = val._def?.typeName || '';
        properties[key] = {
          type: typeName === 'ZodNumber' ? 'NUMBER' :
                typeName === 'ZodBoolean' ? 'BOOLEAN' :
                typeName === 'ZodArray' ? 'ARRAY' :
                typeName === 'ZodRecord' ? 'OBJECT' : 'STRING',
          description: val._def?.description || val.description || key
        };
        if (typeName !== 'ZodOptional' && (!val.isOptional || !val.isOptional())) {
          required.push(key);
        }
      }

      return {
        name: t.name,
        description: t.description,
        parameters: {
          type: 'OBJECT',
          properties,
          required: required.length ? required : undefined
        }
      };
    })
  }];
}

/**
 * Format tools for Anthropic API
 */
function formatToolsForAnthropic(tools = []) {
  if (!tools.length) return undefined;
  return tools.map(t => {
    const zodShape = getZodShape(t.parameters);
    const properties = {};
    const required = [];

    for (const [key, val] of Object.entries(zodShape)) {
      const typeName = val._def?.typeName || '';
      properties[key] = {
        type: typeName === 'ZodNumber' ? 'number' :
              typeName === 'ZodBoolean' ? 'boolean' :
              typeName === 'ZodArray' ? 'array' :
              typeName === 'ZodRecord' ? 'object' : 'string',
        description: val._def?.description || val.description || key
      };
      if (typeName !== 'ZodOptional' && (!val.isOptional || !val.isOptional())) {
        required.push(key);
      }
    }

    return {
      name: t.name,
      description: t.description,
      input_schema: {
        type: 'object',
        properties,
        required: required.length ? required : undefined
      }
    };
  });
}

/**
 * Main provider-agnostic generator: streamChat
 * Yields normalized events:
 * - { type: 'text_delta', delta: '...' }
 * - { type: 'tool_call', id, name, args }
 * - { type: 'usage', tokens_in, tokens_out }
 * - { type: 'done', reason }
 * - { type: 'error', error }
 */
export async function* streamChat({
  system = '',
  messages = [],
  tools = TOOL_DEFINITIONS,
  signal,
  maxTokens = 2048,
  temperature = 0.2
}) {
  const provider = (process.env.LLM_PROVIDER || 'mock').toLowerCase();
  const apiKey = process.env.LLM_API_KEY || process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY || '';
  const model = process.env.LLM_MODEL || (provider === 'gemini' ? 'gemini-flash-lite-latest' : provider === 'anthropic' ? 'claude-3-5-sonnet-20241022' : 'munim-mock-v1');

  // Fallback to mock if API key is missing or explicitly requested
  if (provider === 'mock' || !apiKey) {
    yield* streamMockChat({ system, messages, tools, signal });
    return;
  }

  try {
    if (provider === 'gemini') {
      yield* streamGeminiChat({ system, messages, tools, signal, apiKey, model, maxTokens, temperature });
    } else if (provider === 'anthropic') {
      yield* streamAnthropicChat({ system, messages, tools, signal, apiKey, model, maxTokens, temperature });
    } else {
      yield* streamMockChat({ system, messages, tools, signal });
    }
  } catch (err) {
    console.warn(`[LLM ${provider}] Provider stream encountered an issue: ${err.message}. Engaging deterministic fallback engine.`);
    if (process.env.ENABLE_DEMO_FALLBACK !== 'false') {
      yield* streamMockChat({ system, messages, tools, signal });
    } else {
      throw err;
    }
  }
}

/**
 * Stream Gemini SSE
 */
async function* streamGeminiChat({ system, messages, tools, signal, apiKey, model, maxTokens, temperature }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;

  // Format contents
  const contents = [];
  for (const m of messages) {
    if (m.role === 'user') {
      contents.push({ role: 'user', parts: [{ text: m.content }] });
    } else if (m.role === 'assistant') {
      const parts = [];
      if (m.content) parts.push({ text: m.content });
      if (m.tool_calls) {
        for (const tc of m.tool_calls) {
          const part = { functionCall: { name: tc.name, args: tc.args } };
          if (tc.thoughtSignature) {
            part.thoughtSignature = tc.thoughtSignature;
          }
          parts.push(part);
        }
      }
      contents.push({ role: 'model', parts });
    } else if (m.role === 'tool') {
      const toolPart = {
        functionResponse: {
          name: m.name || 'tool_result',
          response: { content: m.content }
        }
      };
      const lastContent = contents[contents.length - 1];
      if (lastContent && lastContent.role === 'user' && lastContent.parts?.some(p => p.functionResponse)) {
        lastContent.parts.push(toolPart);
      } else {
        contents.push({
          role: 'user',
          parts: [toolPart]
        });
      }
    }
  }

  const payload = {
    contents,
    systemInstruction: system ? { parts: [{ text: system }] } : undefined,
    tools: formatToolsForGemini(tools),
    generationConfig: {
      temperature,
      maxOutputTokens: maxTokens
    }
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  if (signal) {
    signal.addEventListener('abort', () => controller.abort());
  }

  try {
    let response;
    let attempts = 0;
    while (attempts < 2) {
      attempts++;
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      if (response.ok) break;

      if ((response.status === 429 || response.status >= 500) && attempts < 2) {
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }
      const errText = await response.text();
      throw new Error(`Gemini API error (${response.status}): ${errText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let totalTokensIn = 0;
    let totalTokensOut = 0;
    let turnThoughtSignature = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const jsonStr = line.slice(6).trim();
        if (!jsonStr || jsonStr === '[DONE]') continue;

        try {
          const chunk = JSON.parse(jsonStr);
          const candidate = chunk.candidates?.[0];
          const parts = candidate?.content?.parts || [];

          for (const p of parts) {
            if (p.thoughtSignature || p.thought_signature) {
              turnThoughtSignature = p.thoughtSignature || p.thought_signature;
            }
            if (p.text) {
              yield { type: 'text_delta', delta: p.text };
            }
            if (p.functionCall) {
              const thoughtSignature = p.thoughtSignature || p.thought_signature || p.functionCall?.thoughtSignature || p.functionCall?.thought_signature || turnThoughtSignature;
              yield {
                type: 'tool_call',
                id: p.functionCall.id || `call_${Date.now()}_${Math.random().toString(36).substring(7)}`,
                name: p.functionCall.name,
                args: p.functionCall.args || {},
                thoughtSignature
              };
            }
          }

          if (chunk.usageMetadata) {
            totalTokensIn = chunk.usageMetadata.promptTokenCount || totalTokensIn;
            totalTokensOut = chunk.usageMetadata.candidatesTokenCount || totalTokensOut;
          }

          if (candidate?.finishReason) {
            yield {
              type: 'done',
              reason: candidate.finishReason === 'STOP' ? 'stop' : 'tool_calls'
            };
          }
        } catch {
          // ignore malformed chunks
        }
      }
    }

    yield { type: 'usage', tokens_in: totalTokensIn || 150, tokens_out: totalTokensOut || 80 };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Stream Anthropic SSE
 */
async function* streamAnthropicChat({ system, messages, tools, signal, apiKey, model, maxTokens, temperature }) {
  const url = 'https://api.anthropic.com/v1/messages';

  // Format messages for Anthropic
  const anthropicMessages = [];
  for (const m of messages) {
    if (m.role === 'user') {
      anthropicMessages.push({ role: 'user', content: m.content });
    } else if (m.role === 'assistant') {
      const content = [];
      if (m.content) content.push({ type: 'text', text: m.content });
      if (m.tool_calls) {
        for (const tc of m.tool_calls) {
          content.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.args });
        }
      }
      anthropicMessages.push({ role: 'assistant', content });
    } else if (m.role === 'tool') {
      const toolResultBlock = {
        type: 'tool_result',
        tool_use_id: m.tool_call_id || 'call_default',
        content: m.content
      };
      const lastMsg = anthropicMessages[anthropicMessages.length - 1];
      if (lastMsg && lastMsg.role === 'user' && Array.isArray(lastMsg.content) && lastMsg.content.some(c => c.type === 'tool_result')) {
        lastMsg.content.push(toolResultBlock);
      } else {
        anthropicMessages.push({
          role: 'user',
          content: [toolResultBlock]
        });
      }
    }
  }

  const payload = {
    model,
    system,
    messages: anthropicMessages,
    tools: formatToolsForAnthropic(tools),
    max_tokens: maxTokens,
    temperature,
    stream: true
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  if (signal) {
    signal.addEventListener('abort', () => controller.abort());
  }

  try {
    let response;
    let attempts = 0;
    while (attempts < 2) {
      attempts++;
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      if (response.ok) break;

      if ((response.status === 429 || response.status >= 500) && attempts < 2) {
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }
      const errText = await response.text();
      throw new Error(`Anthropic API error (${response.status}): ${errText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let currentToolCall = null;
    let totalTokensIn = 0;
    let totalTokensOut = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const jsonStr = line.slice(6).trim();
        if (!jsonStr) continue;

        try {
          const chunk = JSON.parse(jsonStr);
          if (chunk.type === 'content_block_start') {
            if (chunk.content_block?.type === 'tool_use') {
              currentToolCall = {
                id: chunk.content_block.id,
                name: chunk.content_block.name,
                argsJson: ''
              };
            }
          } else if (chunk.type === 'content_block_delta') {
            if (chunk.delta?.type === 'text_delta') {
              yield { type: 'text_delta', delta: chunk.delta.text };
            } else if (chunk.delta?.type === 'input_json_delta' && currentToolCall) {
              currentToolCall.argsJson += chunk.delta.partial_json;
            }
          } else if (chunk.type === 'content_block_stop' && currentToolCall) {
            let parsedArgs = {};
            try {
              parsedArgs = JSON.parse(currentToolCall.argsJson || '{}');
            } catch {
              parsedArgs = {};
            }
            yield {
              type: 'tool_call',
              id: currentToolCall.id,
              name: currentToolCall.name,
              args: parsedArgs
            };
            currentToolCall = null;
          } else if (chunk.type === 'message_delta') {
            if (chunk.usage) totalTokensOut = chunk.usage.output_tokens || totalTokensOut;
          } else if (chunk.type === 'message_start' && chunk.message?.usage) {
            totalTokensIn = chunk.message.usage.input_tokens || totalTokensIn;
          }
        } catch {
          // ignore stream parse errors
        }
      }
    }

    yield { type: 'usage', tokens_in: totalTokensIn || 180, tokens_out: totalTokensOut || 90 };
    yield { type: 'done', reason: 'stop' };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Deterministic Mock Provider
 * Used for evaluation, unit tests, and instant demo access without API keys
 */
export async function* streamMockChat({ system, messages, tools, signal }) {
  const lastMsg = messages[messages.length - 1];
  const lastText = (lastMsg?.content || '').toLowerCase();

  // If the last message was a tool result, formulate the grounded response
  const lastToolMsg = [...messages].reverse().find(m => m.role === 'tool');

  if (lastToolMsg && lastToolMsg.content) {
    let rawContent = lastToolMsg.content;
    const match = typeof rawContent === 'string' && rawContent.match(/<tool_result[^>]*>([\s\S]*?)<\/tool_result>/i);
    if (match) {
      rawContent = match[1].trim();
    }
    let parsedResult = {};
    try {
      parsedResult = JSON.parse(rawContent);
    } catch {
      parsedResult = { data: {}, display: {} };
    }

    const { data = {}, display = {}, sources = [], calc_id = 'calc:default' } = parsedResult;

    let responseText = '';
    const firstSourceId = sources[0]?.id ? `[txn:${sources[0].id}]` : `[calc:${calc_id}]`;

    if (display.total_spent) {
      responseText = `Aapka total spending ${display.total_spent} raha hai, aur total income ${display.total_income || 'N/A'} hai [calc:${calc_id}]. Net savings ${display.net_savings || '₹0'} (${display.savings_rate || '0%'}) bachi hai ${firstSourceId}.`;
    } else if (display.matching_count) {
      responseText = `Maine aapke records me se ${display.matching_count} dhundhe hain [calc:${calc_id}]. Total amount ${display.total_value_shown || '₹0'} hai ${firstSourceId}.`;
    } else if (display.top_merchant_name) {
      responseText = `Aapka sabse bada kharcha ${display.top_merchant_name} par hua hai (${display.top_merchant_amount}) [calc:${calc_id}] ${firstSourceId}.`;
    } else if (display.monthly_total_cost) {
      responseText = `Aapke total ${display.total_recurring_items} detect hue hain [calc:${calc_id}]. Inka total monthly cost ${display.monthly_total_cost} aur annual cost ${display.annual_total_cost} hai ${firstSourceId}.`;
    } else if (display.flags_count) {
      responseText = `Aapke account me ${display.flags_count} review ke liye flag hue hain [calc:${calc_id}]. Inhe neutral criteria ke tahat review ke liye suggest kiya gaya hai ${firstSourceId}.`;
    } else if (display.scenario_monthly_surplus) {
      responseText = `Scenario analysis ke anusaar, aapka monthly surplus ${display.scenario_monthly_surplus} ho jayega aur goal ${display.months_to_goal} me complete hone ka anumaan hai [calc:${calc_id}].`;
    } else if (display.proposal_summary) {
      responseText = `Maine ye action prepare kiya hai: ${display.proposal_summary} [calc:${calc_id}]. Kripya niche diye gaye card me confirm karein.`;
    } else if (display.total_transactions) {
      responseText = `Aapke paas ${display.date_range} ke dauran kul ${display.total_transactions} hain [calc:${calc_id}]. Data type: ${display.data_type}.`;
    } else {
      const firstKey = Object.keys(display)[0];
      responseText = `Aapke financial records ke anusaar: ${firstKey ? `${firstKey}: ${display[firstKey]}` : 'Data uplabdh hai'} [calc:${calc_id}] ${firstSourceId}.`;
    }

    // Stream text in words
    const words = responseText.split(' ');
    for (const w of words) {
      if (signal?.aborted) return;
      yield { type: 'text_delta', delta: w + ' ' };
      await new Promise(r => setTimeout(r, 8));
    }
    yield { type: 'usage', tokens_in: 120, tokens_out: 40 };
    yield { type: 'done', reason: 'stop' };
    return;
  }

  // First turn: determine which tool to call based on the user prompt
  if (lastText.includes('overview') || lastText.includes('kya data') || lastText.includes('range')) {
    yield { type: 'tool_call', id: 'call_overview', name: 'get_data_overview', args: {} };
  } else if (lastText.includes('recurring') || lastText.includes('subscription') || lastText.includes('bill')) {
    yield { type: 'tool_call', id: 'call_rec', name: 'list_recurring', args: {} };
  } else if (lastText.includes('flag') || lastText.includes('unusual') || lastText.includes('review') || lastText.includes('suspicious')) {
    yield { type: 'tool_call', id: 'call_flags', name: 'list_flags', args: { status: 'open' } };
  } else if (lastText.includes('goal') || lastText.includes('target') || lastText.includes('emergency fund')) {
    yield { type: 'tool_call', id: 'call_goal', name: 'get_goal_progress', args: {} };
  } else if (lastText.includes('scenario') || lastText.includes('cut') || lastText.includes('projection') || lastText.includes('agar')) {
    yield { type: 'tool_call', id: 'call_scenario', name: 'run_scenario', args: { extra_monthly_income: 5000 } };
  } else if (lastText.includes('swiggy') || lastText.includes('zomato') || lastText.includes('netflix') || lastText.includes('amazon') || lastText.includes('uber') || lastText.includes('spend on')) {
    const qMatch = lastText.match(/swiggy|zomato|netflix|amazon|uber|salary|rent|groceries/i);
    yield { type: 'tool_call', id: 'call_search', name: 'search_transactions', args: { query: qMatch ? qMatch[0] : undefined } };
  } else if (lastText.includes('top merchant') || lastText.includes('sabse zyada') || lastText.includes('where did i spend')) {
    yield { type: 'tool_call', id: 'call_merchants', name: 'top_merchants', args: { limit: 5 } };
  } else if (lastText.includes('category') || lastText.includes('dining') || lastText.includes('breakdown')) {
    yield { type: 'tool_call', id: 'call_cats', name: 'get_category_breakdown', args: { limit: 5 } };
  } else if (lastText.includes('compare') || lastText.includes('pichle mahine')) {
    yield { type: 'tool_call', id: 'call_comp', name: 'compare_periods', args: { a_from: '2026-08-01', a_to: '2026-08-31', b_from: '2026-09-01', b_to: '2026-09-30' } };
  } else if (lastText.includes('propose') || lastText.includes('change category') || lastText.includes('badal do')) {
    yield {
      type: 'tool_call',
      id: 'call_prop',
      name: 'propose_action',
      args: { kind: 'recategorise', payload: { merchant: 'Swiggy', category: 'Dining' } }
    };
  } else {
    // Default to summary
    yield { type: 'tool_call', id: 'call_summary', name: 'get_summary', args: {} };
  }

  yield { type: 'done', reason: 'tool_calls' };
}
