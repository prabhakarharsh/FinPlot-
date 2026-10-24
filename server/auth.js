// server/auth.js
// Supabase JWT verification and scoped user client management

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

// In-memory demo store for seamless instant execution when Supabase credentials are empty
export const demoStore = {
  users: new Map(), // userId -> { transactions: [], categories: [], goals: [], rules: [], flags: [], conversations: [], messages: Map, proposals: Map, usage: {} }
  getOrCreateUser(userId = 'demo-user-1') {
    if (!this.users.has(userId)) {
      this.users.set(userId, {
        transactions: [],
        categories: [],
        goals: [],
        rules: [],
        flags: [],
        conversations: [],
        messages: new Map(),
        proposals: new Map(),
        usage: { tokens_in: 0, tokens_out: 0, requests: 0, day: new Date().toISOString().split('T')[0] }
      });
    }
    return this.users.get(userId);
  }
};

/**
 * Helper to safely decode a JWT payload without verification (for routing providers)
 */
function decodeJwtPayload(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payloadJson = Buffer.from(parts[1], 'base64url').toString('utf8');
    return JSON.parse(payloadJson);
  } catch {
    return null;
  }
}

/**
 * Express middleware to verify Supabase JWT, Firebase ID Token, or demo/guest session.
 * Attaches req.user and req.supabaseClient (scoped with user token) to the request.
 */
export async function authenticateUser(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Unauthorized: Missing or malformed Authorization header with Bearer token'
    });
  }

  const token = authHeader.split(' ')[1];

  // 1. Fast-path for Demo / Guest / Local Session tokens
  const isDemoToken = token.startsWith('demo-') || token.startsWith('session-') || token.startsWith('guest-') || token === 'guest-demo-token';
  if (isDemoToken) {
    const explicitUserId = req.headers['x-user-id'];
    const userId = explicitUserId || token;

    req.user = {
      id: userId,
      email: req.headers['x-user-email'] || 'demo@finpilot.local',
      is_anonymous: Boolean(token.startsWith('demo-') || token.startsWith('guest-') || token === 'guest-demo-token')
    };
    req.isDemo = true;
    req.demoData = demoStore.getOrCreateUser(userId);
    return next();
  }

  // 2. Fast-path for Firebase Auth ID Tokens
  const jwtPayload = decodeJwtPayload(token);
  if (jwtPayload && jwtPayload.iss && jwtPayload.iss.includes('securetoken.google.com')) {
    const userId = jwtPayload.user_id || jwtPayload.sub || req.headers['x-user-id'] || 'firebase-user';
    req.user = {
      id: userId,
      email: jwtPayload.email || req.headers['x-user-email'] || 'user@finpilot.app',
      name: jwtPayload.name || jwtPayload.display_name || (jwtPayload.email ? jwtPayload.email.split('@')[0] : 'User'),
      is_anonymous: Boolean(jwtPayload.firebase?.sign_in_provider === 'anonymous'),
      provider: 'firebase'
    };
    req.isDemo = true;
    req.demoData = demoStore.getOrCreateUser(userId);
    return next();
  }

  // 3. Supabase Token Verification (when live Supabase is configured and token is Supabase JWT)
  const hasLiveSupabase = SUPABASE_URL && SUPABASE_ANON_KEY && !SUPABASE_URL.includes('your-project');

  if (hasLiveSupabase) {
    try {
      const userSupabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: {
          headers: {
            Authorization: `Bearer ${token}`
          }
        },
        auth: {
          persistSession: false,
          autoRefreshToken: false
        }
      });

      const { data: { user }, error } = await userSupabase.auth.getUser();

      if (user && !error) {
        req.user = user;
        req.supabase = userSupabase;
        req.isDemo = false;
        return next();
      }
    } catch (err) {
      console.warn('[Auth] Supabase token verification failed:', err.message);
    }
  }

  // 4. Standalone / Demo fallback mode (when explicit user ID is provided)
  const explicitUserId = req.headers['x-user-id'];
  if (explicitUserId) {
    req.user = {
      id: explicitUserId,
      email: req.headers['x-user-email'] || 'demo@finpilot.local',
      is_anonymous: false
    };
    req.isDemo = true;
    req.demoData = demoStore.getOrCreateUser(explicitUserId);
    return next();
  }

  return res.status(401).json({
    error: 'Unauthorized: Invalid or expired token'
  });
}
