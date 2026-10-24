// server/index.js
// Main entrypoint for FinPilot Express application

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import chatRouter from './routes/chat.js';
import { demoStore, authenticateUser } from './auth.js';
import { DEFAULT_CATEGORIES } from '../shared/constants.js';
import { parseVoiceTransaction } from '../shared/nlp_transaction_parser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const app = express();
const PORT = process.env.PORT || 3000;

// Security and utility middlewares
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Health Check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'FinPilot AI Personal Finance Copilot',
    version: '1.0.0',
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

// Public Configuration endpoint (exposes public keys safely)
app.get('/api/config', (req, res) => {
  const supabaseUrl = process.env.SUPABASE_URL || '';
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || '';
  const isSupabaseConfigured = Boolean(
    supabaseUrl &&
    supabaseAnonKey &&
    !supabaseUrl.includes('your-project')
  );

  res.json({
    supabaseConfigured: isSupabaseConfigured,
    supabaseUrl: isSupabaseConfigured ? supabaseUrl : null,
    supabaseAnonKey: isSupabaseConfigured ? supabaseAnonKey : null,
    llmProvider: process.env.LLM_PROVIDER || 'gemini',
    demoFallbackEnabled: true
  });
});

// Demo Data Sync Endpoints (for instant offline trial without live Supabase)
app.post('/api/demo/sync', authenticateUser, (req, res) => {
  const { transactions, categories, goals, rules, flags, userId: bodyUserId } = req.body;
  const targetUserId = bodyUserId || req.user?.id || 'demo-user-1';
  const store = demoStore.getOrCreateUser(targetUserId);

  if (Array.isArray(transactions)) store.transactions = transactions;
  if (Array.isArray(categories)) store.categories = categories;
  if (Array.isArray(goals)) store.goals = goals;
  if (Array.isArray(rules)) store.rules = rules;
  if (Array.isArray(flags)) store.flags = flags;

  if (req.demoData && req.demoData !== store) {
    if (Array.isArray(transactions)) req.demoData.transactions = transactions;
    if (Array.isArray(categories)) req.demoData.categories = categories;
    if (Array.isArray(goals)) req.demoData.goals = goals;
  }

  res.json({
    success: true,
    message: 'Store synchronized successfully',
    counts: {
      transactions: store.transactions.length,
      categories: store.categories.length,
      goals: store.goals.length
    }
  });
});

// Voice / Natural Language Transaction Parse Endpoint
app.post('/api/transactions/parse-voice', (req, res) => {
  const { text, userRules, defaultDate } = req.body || {};
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ ok: false, error: 'Text string is required to parse transaction' });
  }
  const result = parseVoiceTransaction(text, { userRules, defaultDate });
  return res.json(result);
});

// Chat Route
app.use('/api/chat', chatRouter);

// Serve shared module to browser ES modules
app.use('/shared', express.static(path.join(rootDir, 'shared')));

// Serve frontend assets
app.use(express.static(path.join(rootDir, 'public')));

// Fallback to index.html for SPA client-side routing
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'Endpoint not found' });
  }
  res.sendFile(path.join(rootDir, 'public', 'index.html'));
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('[FinPilot Server Error]', err);
  res.status(500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'production' ? 'An unexpected error occurred' : err.message
  });
});

// Start listening unless explicitly disabled by test runner
const isDirectRun = !process.env.FINPILOT_NO_LISTEN;

if (isDirectRun) {
  app.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(`🚀 FinPilot Server running on port ${PORT}`);
    console.log(`• Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`• LLM Provider: ${process.env.LLM_PROVIDER || 'gemini'}`);
    console.log(`• Supabase: ${process.env.SUPABASE_URL && !process.env.SUPABASE_URL.includes('your-project') ? 'Configured' : 'Demo / Standalone Mode'}`);
    console.log(`====================================================`);
  });
}

export default app;
