// server/routes/chat.js
// Express API Router for Munim AI Copilot
// Implements SSE Streaming, Conversation History, Feedback, Proposals, and Rate Quotas

import express from 'express';
import { z } from 'zod';
import { authenticateUser } from '../auth.js';
import { runMunimAgent } from '../chat/agent.js';
import { SAMPLE_TRANSACTIONS } from '../../shared/sample_data.js';

const router = express.Router();

// Rate limiting and concurrency locks
const requestRates = new Map(); // userId -> { count, windowStart }
const activeUserLocks = new Set(); // userId set
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 60000;
const DAILY_TOKEN_BUDGET = parseInt(process.env.DAILY_TOKEN_BUDGET || '50000', 10);

/**
 * Generate 6-word title from first message
 */
export function generateConversationTitle(messageText) {
  if (!messageText || typeof messageText !== 'string') return 'New Conversation';
  const clean = messageText.trim().replace(/\s+/g, ' ');
  const words = clean.split(' ').slice(0, 6);
  let title = words.join(' ');
  if (title.length > 40) title = title.slice(0, 37) + '...';
  return title || 'New Conversation';
}

/**
 * Input Schema Validation
 */
const chatMessageSchema = z.object({
  conversation_id: z.string().nullish().or(z.literal('')),
  message: z.union([z.string(), z.null(), z.undefined()]).transform(v => (v || '').trim()),
  transactions: z.array(z.any()).nullish().transform(v => v || []),
  goals: z.array(z.any()).nullish().transform(v => v || []),
  categories: z.array(z.any()).nullish().transform(v => v || [])
}).refine(data => Boolean(data.message && data.message.length > 0), {
  message: 'Please provide a non-empty message'
});

/**
 * POST /api/chat - Stream conversation response via SSE
 */
router.post('/', authenticateUser, async (req, res) => {
  const userId = req.user.id;
  const now = Date.now();

  // 1. Rate limiting check (20 requests per minute)
  const rateInfo = requestRates.get(userId) || { count: 0, windowStart: now };
  if (now - rateInfo.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateInfo.count = 1;
    rateInfo.windowStart = now;
  } else {
    rateInfo.count++;
  }
  requestRates.set(userId, rateInfo);

  if (rateInfo.count > RATE_LIMIT_MAX) {
    return res.status(429).json({
      error: 'Rate limit exceeded: You have reached the maximum of 20 requests per minute. Please pause for a moment.'
    });
  }

  // 2. Concurrency lock (1 in-flight request per user)
  if (activeUserLocks.has(userId)) {
    return res.status(429).json({
      error: 'A response is already being generated for your account. Please wait or stop the current request.'
    });
  }
  activeUserLocks.add(userId);

  // 3. Input validation
  const validation = chatMessageSchema.safeParse(req.body);
  if (!validation.success) {
    activeUserLocks.delete(userId);
    return res.status(400).json({
      error: 'Invalid request: ' + validation.error.issues.map(i => i.message).join(', ')
    });
  }

  const { conversation_id, message } = validation.data;
  const isDemo = req.isDemo;
  const demoData = req.demoData;

  // 4. Token budget check
  const todayDate = new Date().toISOString().split('T')[0];
  let dailyTokensUsed = 0;
  if (!isDemo && req.supabase) {
    const { data: usage } = await req.supabase
      .from('chat_usage')
      .select('tokens_in, tokens_out')
      .eq('user_id', userId)
      .eq('day', todayDate)
      .maybeSingle();
    dailyTokensUsed = (usage?.tokens_in || 0) + (usage?.tokens_out || 0);
  } else if (demoData) {
    if (demoData.usage.day !== todayDate) {
      demoData.usage = { tokens_in: 0, tokens_out: 0, requests: 0, day: todayDate };
    }
    dailyTokensUsed = demoData.usage.tokens_in + demoData.usage.tokens_out;
  }

  if (dailyTokensUsed >= DAILY_TOKEN_BUDGET) {
    activeUserLocks.delete(userId);
    return res.status(429).json({
      error: `Daily token limit reached (${DAILY_TOKEN_BUDGET} tokens). Your limit resets tomorrow.`
    });
  }

  // 5. Setup Server-Sent Events headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  const sendEvent = (eventName, data) => {
    if (res.writableEnded) return;
    res.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const abortController = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) {
      abortController.abort();
    }
    activeUserLocks.delete(userId);
  });

  try {
    // 6. Resolve or create conversation
    let convId = conversation_id;
    let history = [];

    if (!convId) {
      convId = `conv-${Date.now()}-${Math.random().toString(36).substring(7)}`;
      const title = generateConversationTitle(message);
      if (!isDemo && req.supabase) {
        const { data: newConv } = await req.supabase
          .from('chat_conversations')
          .insert([{ id: convId, user_id: userId, title }])
          .select()
          .single();
        if (newConv) convId = newConv.id;
      } else if (demoData) {
        demoData.conversations.unshift({ id: convId, title, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
        demoData.messages.set(convId, []);
      }
    } else {
      // Fetch recent messages
      if (!isDemo && req.supabase) {
        const { data: msgs } = await req.supabase
          .from('chat_messages')
          .select('role, content')
          .eq('conversation_id', convId)
          .order('created_at', { ascending: true })
          .limit(12);
        history = msgs || [];
      } else if (demoData) {
        history = demoData.messages.get(convId) || [];
      }
    }

    sendEvent('status', { message: 'Thinking...', conversation_id: convId });

    // 7. Load User Context
    let userTransactions = [];
    let userCategories = [];
    let userGoals = [];
    let userFlags = [];
    let isSample = false;

    const bodyTxns = Array.isArray(req.body.transactions) ? req.body.transactions : [];
    const bodyGoals = Array.isArray(req.body.goals) ? req.body.goals : [];
    const bodyCats = Array.isArray(req.body.categories) ? req.body.categories : [];

    if (!isDemo && req.supabase) {
      const [{ data: txns }, { data: cats }, { data: goals }, { data: flags }] = await Promise.all([
        req.supabase.from('transactions').select('*').order('txn_date', { ascending: false }),
        req.supabase.from('categories').select('*'),
        req.supabase.from('goals').select('*'),
        req.supabase.from('flags').select('*')
      ]);

      const catMap = new Map((cats || []).map(c => [c.id, c.name]));
      const dbTxnsMapped = (txns || []).map(t => ({
        ...t,
        category_name: t.category_name || (t.category_id ? catMap.get(t.category_id) : 'Uncategorised') || 'Uncategorised'
      }));

      // Prioritize live client transactions if provided by active session
      userTransactions = bodyTxns.length > 0 ? bodyTxns : dbTxnsMapped;
      userCategories = bodyCats.length > 0 ? bodyCats : (cats || []);
      userGoals = bodyGoals.length > 0 ? bodyGoals : (goals || []);
      userFlags = flags || [];
      isSample = Boolean(userTransactions[0]?.is_sample || userTransactions[0]?.id?.startsWith('sample-'));
    } else {
      // Demo / Local session: prioritize client transactions, then demoStore
      const demoTxns = demoData?.transactions || [];
      userTransactions = bodyTxns.length > 0 ? bodyTxns : demoTxns;
      userCategories = bodyCats.length > 0 ? bodyCats : (demoData?.categories || []);
      userGoals = bodyGoals.length > 0 ? bodyGoals : (demoData?.goals || []);
      userFlags = demoData?.flags || [];
      isSample = Boolean(userTransactions[0]?.is_sample || userTransactions[0]?.id?.startsWith('sample-'));
    }

    const context = {
      transactions: userTransactions,
      categories: userCategories,
      goals: userGoals,
      flags: userFlags,
      is_sample: isSample,
      userId
    };

    // 8. Run Agent Loop
    const agentGenerator = runMunimAgent({
      userMessage: message,
      history,
      context,
      signal: abortController.signal
    });

    let finalDoneData = null;

    for await (const chunk of agentGenerator) {
      if (abortController.signal.aborted) break;

      sendEvent(chunk.event, chunk.data);
      if (chunk.event === 'done') {
        finalDoneData = chunk.data;
      }
    }

    // 9. Persist Messages & Update Usage
    if (finalDoneData && !abortController.signal.aborted) {
      const userMsgRecord = {
        id: `msg-usr-${Date.now()}`,
        conversation_id: convId,
        user_id: userId,
        role: 'user',
        content: message,
        created_at: new Date().toISOString()
      };

      const asstMsgRecord = {
        id: `msg-asst-${Date.now()}`,
        conversation_id: convId,
        user_id: userId,
        role: 'assistant',
        content: finalDoneData.content,
        sources: finalDoneData.sources || [],
        tools_used: finalDoneData.tools_used || [],
        verified: finalDoneData.verified ?? true,
        tokens_in: finalDoneData.tokens_in || 0,
        tokens_out: finalDoneData.tokens_out || 0,
        created_at: new Date().toISOString()
      };

      if (!isDemo && req.supabase) {
        await req.supabase.from('chat_messages').insert([userMsgRecord, asstMsgRecord]);
        // Upsert usage
        const totalIn = finalDoneData.tokens_in || 0;
        const totalOut = finalDoneData.tokens_out || 0;
        await req.supabase.rpc('increment_chat_usage', {
          p_user_id: userId,
          p_day: todayDate,
          p_tokens_in: totalIn,
          p_tokens_out: totalOut
        }).catch(() => {});
      } else if (demoData) {
        const list = demoData.messages.get(convId) || [];
        list.push(userMsgRecord, asstMsgRecord);
        demoData.messages.set(convId, list);

        demoData.usage.tokens_in += finalDoneData.tokens_in || 0;
        demoData.usage.tokens_out += finalDoneData.tokens_out || 0;
        demoData.usage.requests += 1;

        // Persist any generated proposals
        if (Array.isArray(finalDoneData.proposals)) {
          for (const prop of finalDoneData.proposals) {
            demoData.proposals.set(prop.proposal_id, {
              id: prop.proposal_id,
              user_id: userId,
              message_id: asstMsgRecord.id,
              kind: prop.kind,
              payload: prop.payload,
              status: 'pending',
              created_at: new Date().toISOString()
            });
          }
        }
      }

      // Safe logging (Strict rule: NEVER log message content)
      console.log(`[Munim Chat] turn completed: user=${userId.slice(0, 8)} conv=${convId.slice(0, 8)} tools=${(finalDoneData.tools_used || []).map(t => t.name).join(',')} verified=${finalDoneData.verified} tokens=${(finalDoneData.tokens_in || 0) + (finalDoneData.tokens_out || 0)}`);
    }

    sendEvent('complete', { conversation_id: convId });
    res.end();
  } catch (err) {
    console.error('[Munim Chat Error]', err);
    sendEvent('error', { error: 'Munim encountered an error processing your request. Please try again in a moment.' });
    res.end();
  } finally {
    activeUserLocks.delete(userId);
  }
});

/**
 * GET /api/chat/conversations - List all user conversations
 */
router.get('/conversations', authenticateUser, async (req, res) => {
  const userId = req.user.id;
  const isDemo = req.isDemo;
  const demoData = req.demoData;

  if (!isDemo && req.supabase) {
    const { data, error } = await req.supabase
      .from('chat_conversations')
      .select('id, title, created_at, updated_at')
      .order('updated_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ conversations: data || [] });
  }

  // Demo store
  const conversations = demoData?.conversations || [];
  return res.json({ conversations });
});

/**
 * GET /api/chat/conversations/:id - Get conversation messages
 */
router.get('/conversations/:id', authenticateUser, async (req, res) => {
  const { id } = req.params;
  const isDemo = req.isDemo;
  const demoData = req.demoData;

  if (!isDemo && req.supabase) {
    const { data: messages, error } = await req.supabase
      .from('chat_messages')
      .select('*')
      .eq('conversation_id', id)
      .order('created_at', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ messages: messages || [] });
  }

  // Demo store
  const messages = demoData?.messages?.get(id) || [];
  return res.json({ messages });
});

/**
 * DELETE /api/chat/conversations/:id - Delete conversation
 */
router.delete('/conversations/:id', authenticateUser, async (req, res) => {
  const { id } = req.params;
  const isDemo = req.isDemo;
  const demoData = req.demoData;

  if (!isDemo && req.supabase) {
    const { error } = await req.supabase
      .from('chat_conversations')
      .delete()
      .eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true });
  }

  // Demo store
  if (demoData) {
    demoData.conversations = (demoData.conversations || []).filter(c => c.id !== id);
    demoData.messages?.delete(id);
  }
  return res.json({ success: true });
});

/**
 * POST /api/chat/messages/:id/feedback - Feedback (-1 or 1)
 */
router.post('/messages/:id/feedback', authenticateUser, async (req, res) => {
  const { id } = req.params;
  const { value } = req.body;

  if (![-1, 0, 1].includes(value)) {
    return res.status(400).json({ error: 'Feedback value must be -1, 0, or 1' });
  }

  const isDemo = req.isDemo;
  const demoData = req.demoData;

  if (!isDemo && req.supabase) {
    const { error } = await req.supabase
      .from('chat_messages')
      .update({ feedback: value })
      .eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true, feedback: value });
  }

  // Demo store
  if (demoData?.messages) {
    for (const msgList of demoData.messages.values()) {
      const target = msgList.find(m => m.id === id);
      if (target) {
        target.feedback = value;
        break;
      }
    }
  }

  return res.json({ success: true, feedback: value });
});

/**
 * POST /api/chat/proposals/:id/confirm - Execute proposed action
 */
router.post('/proposals/:id/confirm', authenticateUser, async (req, res) => {
  const { id } = req.params;
  const isDemo = req.isDemo;
  const demoData = req.demoData;
  const userId = req.user.id;

  let proposal = null;

  if (!isDemo && req.supabase) {
    const { data } = await req.supabase
      .from('chat_proposals')
      .select('*')
      .eq('id', id)
      .single();
    proposal = data;
  } else if (demoData?.proposals) {
    proposal = demoData.proposals.get(id);
  }

  if (!proposal) {
    // If not found in memory, try parsing from body for instant client proposals
    if (req.body?.kind && req.body?.payload) {
      proposal = { id, kind: req.body.kind, payload: req.body.payload, status: 'pending' };
    } else {
      return res.status(404).json({ error: 'Proposal not found or expired.' });
    }
  }

  if (proposal.status === 'applied') {
    return res.json({ success: true, message: 'Proposal was already applied.', proposal });
  }

  let resultSummary = '';
  let affectedCount = 0;

  // Execute based on proposal kind through normal financial engine and stores
  if (proposal.kind === 'recategorise') {
    const { merchant, category, txn_id } = proposal.payload;
    if (demoData?.transactions) {
      for (const t of demoData.transactions) {
        if ((merchant && (t.merchant || '').toLowerCase() === merchant.toLowerCase()) || (txn_id && t.id === txn_id)) {
          t.category_name = category;
          t.category_source = 'user';
          affectedCount++;
        }
      }
      demoData.rules.push({ id: `rule-${Date.now()}`, merchant_pattern: (merchant || '').toLowerCase(), category_name: category });
    }
    resultSummary = `Successfully recategorised ${affectedCount} transaction(s) to "${category}".`;
  } else if (proposal.kind === 'create_goal') {
    const { name, target_amount, target_date } = proposal.payload;
    const newGoal = {
      id: `goal-${Date.now()}`,
      name,
      target_amount: Number(target_amount),
      current_amount: 0,
      target_date: target_date || '2026-12-31'
    };
    if (demoData?.goals) {
      demoData.goals.push(newGoal);
    }
    resultSummary = `Created savings goal "${name}" with target ₹${target_amount}.`;
  } else if (proposal.kind === 'dismiss_flag') {
    const { txn_id } = proposal.payload;
    if (demoData?.flags) {
      const flag = demoData.flags.find(f => f.txn_id === txn_id);
      if (flag) flag.status = 'dismissed';
    }
    resultSummary = `Dismissed review flag for transaction.`;
  } else if (proposal.kind === 'add_transaction') {
    const { merchant, amount, category, category_name, date, description, type } = proposal.payload;
    const finalAmount = (type === 'income') ? Math.abs(Number(amount)) : -Math.abs(Number(amount));
    const cat = category || category_name || 'Uncategorised';
    const newTx = {
      id: `tx-munim-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      txn_date: date || new Date().toISOString().slice(0, 10),
      merchant: merchant || 'Voice Transaction',
      description: description || merchant || 'Added via Munim',
      amount: finalAmount,
      category_name: cat,
      category_source: 'user',
      created_at: new Date().toISOString()
    };
    if (demoData?.transactions) {
      demoData.transactions.unshift(newTx);
    }
    affectedCount = 1;
    resultSummary = `Added transaction for ${newTx.merchant} (₹${Math.abs(finalAmount).toFixed(2)}).`;
  }

  proposal.status = 'applied';
  if (!isDemo && req.supabase) {
    await req.supabase.from('chat_proposals').update({ status: 'applied' }).eq('id', id);
  } else if (demoData?.proposals) {
    demoData.proposals.set(id, proposal);
  }

  return res.json({
    success: true,
    message: resultSummary,
    affected_count: affectedCount,
    proposal
  });
});

/**
 * POST /api/chat/proposals/:id/reject - Reject proposed action
 */
router.post('/proposals/:id/reject', authenticateUser, async (req, res) => {
  const { id } = req.params;
  const isDemo = req.isDemo;
  const demoData = req.demoData;

  if (!isDemo && req.supabase) {
    await req.supabase.from('chat_proposals').update({ status: 'rejected' }).eq('id', id);
  } else if (demoData?.proposals) {
    const prop = demoData.proposals.get(id);
    if (prop) {
      prop.status = 'rejected';
      demoData.proposals.set(id, prop);
    }
  }

  return res.json({ success: true, message: 'Proposal dismissed.' });
});

export default router;
