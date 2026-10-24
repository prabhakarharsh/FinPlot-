// public/js/api.js
// API and Supabase communication layer for FinPilot with account data isolation

import { state } from './state.js';
import { DEFAULT_CATEGORIES } from '../../shared/constants.js';
import { SAMPLE_TRANSACTIONS } from '../../shared/sample_data.js';
import { accounts } from './accounts.js';
import { 
  firebaseSignInWithGoogle, 
  firebaseSignUpWithEmail, 
  firebaseSignInWithEmail, 
  firebaseSignOut, 
  onFirebaseAuthStateChange,
  waitForFirebaseAuth 
} from './firebase.js';

let supabaseClient = null;

export const api = {
  config: null,

  async init() {
    try {
      const res = await fetch('/api/config');
      this.config = await res.json();

      if (this.config.supabaseConfigured && window.supabase) {
        supabaseClient = window.supabase.createClient(
          this.config.supabaseUrl,
          this.config.supabaseAnonKey
        );

        // Check if there is an active session (including redirect returns from Google OAuth)
        let { data: { session } } = await supabaseClient.auth.getSession();
        
        // If no active session, auto-authenticate with Supabase guest account so writes to Supabase succeed immediately
        if (!session) {
          try {
            const { data: guestAuth, error: guestErr } = await supabaseClient.auth.signInWithPassword({
              email: 'guest@finpilot.local',
              password: 'GuestUserPass123!'
            });
            if (!guestErr && guestAuth?.session) {
              session = guestAuth.session;
            }
          } catch (gErr) {
            console.warn('[API] Auto-authenticating guest warning:', gErr);
          }
        }

        if (session) {
          if (window.location.hash && window.location.hash.includes('access_token')) {
            window.history.replaceState(null, '', window.location.pathname + window.location.search);
          }
          const userMeta = session.user.user_metadata || {};
          state.currentUser = {
            id: session.user.id,
            name: userMeta.full_name || userMeta.name || session.user.email?.split('@')[0] || 'User',
            email: session.user.email || 'user@finpilot.app',
            token: session.access_token,
            isAnonymous: false,
            avatarUrl: userMeta.avatar_url || null,
            provider: session.user.app_metadata?.provider || 'supabase'
          };
          localStorage.setItem('finpilot_user', JSON.stringify(state.currentUser));
          accounts.saveAccount({
            id: state.currentUser.id,
            name: state.currentUser.name,
            email: state.currentUser.email,
            is_anonymous: false
          });
        }

        // Listen for OAuth state changes
        supabaseClient.auth.onAuthStateChange(async (event, session) => {
          if (session && (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED')) {
            const userMeta = session.user.user_metadata || {};
            state.currentUser = {
              id: session.user.id,
              name: userMeta.full_name || userMeta.name || session.user.email?.split('@')[0] || 'User',
              email: session.user.email || 'user@finpilot.app',
              token: session.access_token,
              isAnonymous: session.user.is_anonymous || false,
              avatarUrl: userMeta.avatar_url || null,
              provider: session.user.app_metadata?.provider || 'supabase'
            };
            localStorage.setItem('finpilot_user', JSON.stringify(state.currentUser));
            accounts.saveAccount({
              id: state.currentUser.id,
              name: state.currentUser.name,
              email: state.currentUser.email,
              is_anonymous: state.currentUser.isAnonymous
            });
          }
        });
      }
    } catch (err) {
      console.warn('[API] Could not fetch server config, using local demo fallback:', err);
    }

    // Only check Firebase if no active Supabase session was resolved
    if (!state.currentUser || state.currentUser.provider === 'firebase') {
      try {
        const fbUser = await waitForFirebaseAuth();
        if (fbUser) {
          const token = await fbUser.getIdToken();
          state.currentUser = {
            id: fbUser.uid,
            name: fbUser.displayName || fbUser.email?.split('@')[0] || 'User',
            email: fbUser.email || 'user@finpilot.app',
            token: token,
            avatarUrl: fbUser.photoURL || null,
            isAnonymous: false,
            provider: 'firebase'
          };
          localStorage.setItem('finpilot_user', JSON.stringify(state.currentUser));
          accounts.saveAccount({
            id: state.currentUser.id,
            name: state.currentUser.name,
            email: state.currentUser.email,
            is_anonymous: false
          });
        }
      } catch (e) {
        console.warn('[Firebase] Auth check error:', e);
      }

      // Listen for Firebase Auth state changes
      try {
        onFirebaseAuthStateChange(async (firebaseUser) => {
          if (firebaseUser && (!state.currentUser || state.currentUser.provider === 'firebase')) {
            const token = await firebaseUser.getIdToken();
            state.currentUser = {
              id: firebaseUser.uid,
              name: firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'User',
              email: firebaseUser.email || 'user@finpilot.app',
              token: token,
              avatarUrl: firebaseUser.photoURL || null,
              isAnonymous: false,
              provider: 'firebase'
            };
            localStorage.setItem('finpilot_user', JSON.stringify(state.currentUser));
            accounts.saveAccount({
              id: state.currentUser.id,
              name: state.currentUser.name,
              email: state.currentUser.email,
              is_anonymous: false
            });
            accounts.updateUserBadgeUI();
          }
        });
      } catch (e) {
        console.warn('[Firebase] Auth state listener error:', e);
      }
    }

    // If no Supabase session, restore from localStorage if user previously logged in
    if (!state.currentUser) {
      const savedUser = localStorage.getItem('finpilot_user');
      if (savedUser) {
        try {
          state.currentUser = JSON.parse(savedUser);
        } catch {
          state.currentUser = null;
        }
      }
    }
  },

  setupDefaultDemoUser() {
    let guestId = localStorage.getItem('finpilot_guest_id');
    if (!guestId) {
      guestId = 'guest-user-' + Math.random().toString(36).substring(7);
      localStorage.setItem('finpilot_guest_id', guestId);
    }
    state.currentUser = {
      id: guestId,
      name: 'Guest User',
      email: 'guest@finpilot.local',
      token: 'demo-guest-token-' + guestId,
      isAnonymous: true
    };
    localStorage.setItem('finpilot_user', JSON.stringify(state.currentUser));
    accounts.saveAccount({
      id: state.currentUser.id,
      name: 'Guest User',
      email: state.currentUser.email,
      is_anonymous: true
    });
  },

  async signInDemo() {
    if (supabaseClient) {
      try {
        const { data, error } = await supabaseClient.auth.signInWithPassword({
          email: 'guest@finpilot.local',
          password: 'GuestUserPass123!'
        });
        if (!error && data?.session) {
          state.currentUser = {
            id: data.user.id,
            name: 'Guest User',
            email: 'guest@finpilot.local',
            token: data.session.access_token,
            isAnonymous: false,
            provider: 'supabase'
          };
          localStorage.setItem('finpilot_user', JSON.stringify(state.currentUser));
          accounts.saveAccount({
            id: state.currentUser.id,
            name: state.currentUser.name,
            email: state.currentUser.email,
            is_anonymous: false
          });
          await this.syncDemoState();
          return;
        }
      } catch (e) {
        console.warn('[Supabase Guest SignIn Warning]:', e);
      }
    }
    this.setupDefaultDemoUser();
    // Start completely clean with zero transactions so user enters their own data
    state.setTransactions([], false);
    state.setGoals([]);
    localStorage.setItem(`finpilot_txns_${state.currentUser.id}`, JSON.stringify([]));
    localStorage.setItem(`finpilot_goals_${state.currentUser.id}`, JSON.stringify([]));
    localStorage.setItem('finpilot_txns', JSON.stringify([]));
    localStorage.setItem('finpilot_goals', JSON.stringify([]));
    localStorage.removeItem(`finpilot_setup_completed_${state.currentUser.id}`);
    localStorage.removeItem(`finpilot_setup_seen_${state.currentUser.id}`);
    localStorage.removeItem(`finpilot_onboarding_dismissed_${state.currentUser.id}`);
    localStorage.removeItem('finpilot_first_run_seen');
    await this.syncDemoState();
  },

  async signInWithEmail(email, password) {
    if (supabaseClient) {
      const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
      if (error) throw error;
      state.currentUser = {
        id: data.user.id,
        name: data.user.user_metadata?.name || data.user.email?.split('@')[0],
        email: data.user.email,
        token: data.session.access_token,
        isAnonymous: false
      };
      localStorage.setItem('finpilot_user', JSON.stringify(state.currentUser));
      accounts.saveAccount({
        id: state.currentUser.id,
        name: state.currentUser.name,
        email: state.currentUser.email,
        is_anonymous: false
      });
      return data;
    }
    // Standalone fallback
    state.currentUser = {
      id: 'user-' + Date.now(),
      name: email.split('@')[0],
      email,
      token: 'demo-token-' + Date.now(),
      isAnonymous: false
    };
    localStorage.setItem('finpilot_user', JSON.stringify(state.currentUser));
    accounts.saveAccount({
      id: state.currentUser.id,
      name: state.currentUser.name,
      email: state.currentUser.email,
      is_anonymous: false
    });
  },

  /**
   * Google OAuth Sign-In (Firebase 1-Click Popup with Supabase fallback)
   */
  async signInWithGoogle() {
    try {
      const { user, token } = await firebaseSignInWithGoogle();
      const googleUser = {
        id: user.uid,
        name: user.displayName || user.email?.split('@')[0] || 'Google User',
        email: user.email,
        token: token,
        avatarUrl: user.photoURL || null,
        isAnonymous: false,
        provider: 'google'
      };

      state.currentUser = googleUser;
      localStorage.setItem('finpilot_user', JSON.stringify(googleUser));
      accounts.saveAccount({
        id: googleUser.id,
        name: googleUser.name,
        email: googleUser.email,
        is_anonymous: false
      });

      return googleUser;
    } catch (firebaseErr) {
      console.warn('[Firebase Google Auth] Error:', firebaseErr);
      if (firebaseErr.code === 'auth/popup-closed-by-user') {
        throw new Error('Google sign-in popup was closed.');
      } else if (firebaseErr.code === 'auth/unauthorized-domain') {
        throw new Error('Domain not authorized in Firebase Console. Add your domain under Authentication > Settings > Authorized domains.');
      } else if (firebaseErr.code === 'auth/operation-not-allowed') {
        throw new Error('Google provider is not enabled in Firebase Console. Go to Firebase Console > Authentication > Sign-in method and enable Google.');
      }

      if (supabaseClient) {
        const redirectTo = window.location.origin + '/index.html';
        const { data, error } = await supabaseClient.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo
          }
        });
        if (error) throw error;
        return data;
      }
      throw firebaseErr;
    }
  },

  async sendMagicLink(email) {
    if (supabaseClient) {
      const { error } = await supabaseClient.auth.signInWithOtp({ email });
      if (error) throw error;
      return true;
    }
    return true;
  },

  async signOut() {
    try {
      await firebaseSignOut();
    } catch (e) {}
    if (supabaseClient) {
      try { await supabaseClient.auth.signOut(); } catch (e) {}
    }
    localStorage.removeItem('finpilot_user');
    state.currentUser = null;
    window.location.href = 'login.html';
  },

  isAuthenticated() {
    return Boolean(state.currentUser && state.currentUser.token);
  },

  async registerWithEmail(email, password) {
    if (supabaseClient) {
      try {
        const { data, error } = await supabaseClient.auth.signUp({ email, password });
        if (error) {
          if (error.message?.toLowerCase().includes('already registered')) {
            throw new Error('This email is already registered. Please click "Sign In" tab.');
          }
          throw error;
        }
        if (data?.user) {
          const newUser = {
            id: data.user.id,
            name: email.split('@')[0],
            email: data.user.email,
            token: data.session?.access_token || 'supabase-session-token',
            isAnonymous: false,
            provider: 'supabase'
          };
          state.currentUser = newUser;
          localStorage.setItem('finpilot_user', JSON.stringify(newUser));
          accounts.saveAccount({
            id: newUser.id,
            name: newUser.name,
            email: newUser.email,
            is_anonymous: false
          });
          state.setTransactions([], false);
          state.setGoals([]);
          localStorage.setItem(`finpilot_txns_${newUser.id}`, JSON.stringify([]));
          localStorage.setItem(`finpilot_goals_${newUser.id}`, JSON.stringify([]));
          return newUser;
        }
      } catch (sbErr) {
        console.warn('[Supabase SignUp Error]', sbErr);
        throw new Error(sbErr.message || 'Account registration failed.');
      }
    }

    // Fallback to Firebase
    try {
      const { user, token } = await firebaseSignUpWithEmail(email, password);
      const newUser = {
        id: user.uid,
        name: email.split('@')[0],
        email: user.email,
        token: token,
        isAnonymous: false,
        provider: 'firebase'
      };
      state.currentUser = newUser;
      localStorage.setItem('finpilot_user', JSON.stringify(newUser));
      accounts.saveAccount({
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        is_anonymous: false
      });
      state.setTransactions([], false);
      state.setGoals([]);
      localStorage.setItem(`finpilot_txns_${newUser.id}`, JSON.stringify([]));
      localStorage.setItem(`finpilot_goals_${newUser.id}`, JSON.stringify([]));
      return newUser;
    } catch (fbErr) {
      if (fbErr.code === 'auth/email-already-in-use') {
        throw new Error('This email is already registered. Please click "Sign In" tab.');
      } else if (fbErr.code === 'auth/weak-password') {
        throw new Error('Password must be at least 6 characters.');
      } else if (fbErr.code === 'auth/invalid-email') {
        throw new Error('Please enter a valid email address.');
      }
      throw fbErr;
    }
  },

  async signInWithRegisteredEmail(email, password) {
    if (supabaseClient) {
      try {
        const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) {
          throw new Error('Invalid email or password. Please verify your credentials or create an account.');
        }
        if (data?.user && data?.session) {
          const signedInUser = {
            id: data.user.id,
            name: data.user.user_metadata?.name || email.split('@')[0],
            email: data.user.email,
            token: data.session.access_token,
            isAnonymous: false,
            provider: 'supabase'
          };
          state.currentUser = signedInUser;
          localStorage.setItem('finpilot_user', JSON.stringify(signedInUser));
          accounts.saveAccount({
            id: signedInUser.id,
            name: signedInUser.name,
            email: signedInUser.email,
            is_anonymous: false
          });
          return signedInUser;
        }
      } catch (sbErr) {
        console.warn('[Supabase SignIn Error]', sbErr);
        throw sbErr;
      }
    }

    // Fallback to Firebase
    try {
      const { user, token } = await firebaseSignInWithEmail(email, password);
      const signedInUser = {
        id: user.uid,
        name: user.displayName || email.split('@')[0],
        email: user.email,
        token: token,
        isAnonymous: false,
        provider: 'firebase'
      };
      state.currentUser = signedInUser;
      localStorage.setItem('finpilot_user', JSON.stringify(signedInUser));
      accounts.saveAccount({
        id: signedInUser.id,
        name: signedInUser.name,
        email: signedInUser.email,
        is_anonymous: false
      });
      return signedInUser;
    } catch (fbErr) {
      if (fbErr.code === 'auth/invalid-credential' || fbErr.code === 'auth/wrong-password' || fbErr.code === 'auth/user-not-found') {
        throw new Error('Invalid email or password. Please verify your credentials or create an account.');
      }
      throw fbErr;
    }
  },

  /**
   * Add a single new transaction
   */
  async addTransaction(newTxn) {
    const userId = state.currentUser?.id || 'demo-user-1';
    const txn = {
      ...newTxn,
      id: newTxn.id || `tx-manual-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      category_source: 'user',
      created_at: new Date().toISOString(),
      hash: `${newTxn.txn_date}_${newTxn.amount}_${newTxn.description}`
    };

    const updated = [txn, ...state.transactions];
    state.setTransactions(updated, false);
    localStorage.setItem(`finpilot_txns_${userId}`, JSON.stringify(updated));
    localStorage.setItem('finpilot_txns', JSON.stringify(updated));

    if (supabaseClient) {
      try {
        const session = (await supabaseClient.auth.getSession())?.data?.session;
        const activeUserId = session?.user?.id || (state.currentUser?.id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(state.currentUser.id) ? state.currentUser.id : null);

        if (activeUserId) {
          const dbPayload = {
            user_id: activeUserId,
            txn_date: txn.txn_date,
            merchant: txn.merchant,
            description: txn.description || txn.merchant,
            amount: txn.amount,
            category_source: txn.category_source || 'user',
            hash: txn.hash
          };
          // If a valid UUID, include id; otherwise let Supabase default to gen_random_uuid()
          if (txn.id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(txn.id)) {
            dbPayload.id = txn.id;
          }
          // Match category_id if available
          const matchedCat = (state.categories || []).find(c => c.name?.toLowerCase() === (txn.category_name || '').toLowerCase());
          if (matchedCat?.id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(matchedCat.id)) {
            dbPayload.category_id = matchedCat.id;
          }

          const { data, error } = await supabaseClient.from('transactions').insert([dbPayload]).select();
          if (error) {
            console.error('[API] Supabase transaction insert error:', error);
          } else if (data && data[0]) {
            txn.id = data[0].id;
            localStorage.setItem(`finpilot_txns_${userId}`, JSON.stringify(state.transactions));
            localStorage.setItem('finpilot_txns', JSON.stringify(state.transactions));
          }
        }
      } catch (err) {
        console.error('[API] Failed to persist transaction to Supabase:', err);
      }
    }

    await this.syncDemoState();
    return txn;
  },

  /**
   * Add multiple new transactions atomically (batch)
   * Avoids multiple consecutive re-renders or canvas tearing
   */
  async addTransactions(newTxns = []) {
    if (!Array.isArray(newTxns) || newTxns.length === 0) return [];
    const userId = state.currentUser?.id || 'demo-user-1';

    const formatted = newTxns.map((newTxn, idx) => ({
      ...newTxn,
      id: newTxn.id || `tx-manual-${Date.now()}-${idx}-${Math.random().toString(36).substring(7)}`,
      category_source: 'user',
      created_at: new Date().toISOString(),
      hash: `${newTxn.txn_date}_${newTxn.amount}_${newTxn.description}`
    }));

    const updated = [...formatted, ...state.transactions];
    state.setTransactions(updated, false);
    localStorage.setItem(`finpilot_txns_${userId}`, JSON.stringify(updated));
    localStorage.setItem('finpilot_txns', JSON.stringify(updated));

    if (supabaseClient) {
      try {
        const session = (await supabaseClient.auth.getSession())?.data?.session;
        const activeUserId = session?.user?.id || (state.currentUser?.id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(state.currentUser.id) ? state.currentUser.id : null);

        if (activeUserId) {
          const dbPayloads = formatted.map(t => {
            const p = {
              user_id: activeUserId,
              txn_date: t.txn_date,
              merchant: t.merchant,
              description: t.description || t.merchant,
              amount: t.amount,
              category_source: t.category_source || 'user',
              hash: t.hash
            };
            if (t.id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t.id)) {
              p.id = t.id;
            }
            return p;
          });
          const { data, error } = await supabaseClient.from('transactions').insert(dbPayloads).select();
          if (error) {
            console.error('[API] Failed to batch persist transactions to Supabase:', error);
          } else if (data) {
            data.forEach((row, i) => {
              if (formatted[i]) formatted[i].id = row.id;
            });
            localStorage.setItem(`finpilot_txns_${userId}`, JSON.stringify(state.transactions));
            localStorage.setItem('finpilot_txns', JSON.stringify(state.transactions));
          }
        }
      } catch (err) {
        console.error('[API] Failed to batch persist transactions to Supabase:', err);
      }
    }

    await this.syncDemoState();
    return formatted;
  },

  /**
   * Delete a single transaction by ID
   */
  async deleteTransaction(txnId) {
    const userId = state.currentUser?.id || 'demo-user-1';
    const target = state.transactions.find(t => t.id === txnId);
    if (!target) return null;

    const updated = state.transactions.filter(t => t.id !== txnId);
    state.setTransactions(updated, state.isSampleData);
    localStorage.setItem(`finpilot_txns_${userId}`, JSON.stringify(updated));
    localStorage.setItem('finpilot_txns', JSON.stringify(updated));

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(txnId);
    if (supabaseClient && !state.currentUser?.isAnonymous && isUuid) {
      try {
        await supabaseClient.from('transactions').delete().eq('id', txnId);
      } catch (err) {
        console.warn('[API] Failed to delete transaction from Supabase:', err);
      }
    }

    await this.syncDemoState();
    return target;
  },

  /**
   * Bulk delete multiple transactions by IDs
   */
  async deleteTransactions(txnIds = []) {
    const userId = state.currentUser?.id || 'demo-user-1';
    const idSet = new Set(txnIds);
    const deleted = state.transactions.filter(t => idSet.has(t.id));
    const updated = state.transactions.filter(t => !idSet.has(t.id));

    state.setTransactions(updated, state.isSampleData);
    localStorage.setItem(`finpilot_txns_${userId}`, JSON.stringify(updated));
    localStorage.setItem('finpilot_txns', JSON.stringify(updated));

    const validUuids = txnIds.filter(id => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));
    if (supabaseClient && !state.currentUser?.isAnonymous && validUuids.length > 0) {
      try {
        await supabaseClient.from('transactions').delete().in('id', validUuids);
      } catch (err) {
        console.warn('[API] Failed to bulk delete from Supabase:', err);
      }
    }

    await this.syncDemoState();
    return deleted;
  },

  /**
   * Add a single new savings goal
   */
  async addGoal(newGoal) {
    const userId = state.currentUser?.id || 'demo-user-1';
    const goal = {
      ...newGoal,
      id: newGoal.id || `goal-${Date.now()}`,
      created_at: new Date().toISOString()
    };
    const updated = [goal, ...state.goals];
    state.setGoals(updated);
    localStorage.setItem(`finpilot_goals_${userId}`, JSON.stringify(updated));
    localStorage.setItem('finpilot_goals', JSON.stringify(updated));

    if (supabaseClient) {
      try {
        const session = (await supabaseClient.auth.getSession())?.data?.session;
        const activeUserId = session?.user?.id || (state.currentUser?.id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(state.currentUser.id) ? state.currentUser.id : null);
        if (activeUserId) {
          const payload = {
            user_id: activeUserId,
            name: goal.name,
            target_amount: goal.target_amount,
            current_amount: goal.current_amount || 0,
            target_date: goal.target_date || null
          };
          const { data, error } = await supabaseClient.from('goals').insert([payload]).select();
          if (!error && data && data[0]) {
            goal.id = data[0].id;
            localStorage.setItem(`finpilot_goals_${userId}`, JSON.stringify(state.goals));
            localStorage.setItem('finpilot_goals', JSON.stringify(state.goals));
          }
        }
      } catch (err) {
        console.warn('[API] Failed to persist goal to Supabase:', err);
      }
    }

    await this.syncDemoState();
    return goal;
  },

  /**
   * Delete a goal by ID
   */
  async deleteGoal(goalId) {
    const userId = state.currentUser?.id || 'demo-user-1';
    const updated = state.goals.filter(g => g.id !== goalId);
    state.setGoals(updated);
    localStorage.setItem(`finpilot_goals_${userId}`, JSON.stringify(updated));
    localStorage.setItem('finpilot_goals', JSON.stringify(updated));

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(goalId);
    if (supabaseClient && isUuid) {
      try {
        await supabaseClient.from('goals').delete().eq('id', goalId);
      } catch (err) {
        console.warn('[API] Failed to delete goal from Supabase:', err);
      }
    }

    await this.syncDemoState();
    return updated;
  },

  /**
   * Load transactions, categories, rules, and goals from Supabase (or localStorage)
   */
  async loadUserData() {
    const userId = state.currentUser?.id || 'demo-user-1';

    // Check if user has an authentic Supabase Auth UUID session
    const isSupabaseAuthUser = Boolean(
      supabaseClient &&
      state.currentUser?.provider !== 'firebase' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)
    );

    if (isSupabaseAuthUser) {
      try {
        const { data: cats } = await supabaseClient.from('categories').select('*');
        if (cats && cats.length > 0) {
          state.setCategories(cats);
        } else {
          state.setCategories(DEFAULT_CATEGORIES);
        }

        const { data: txns, error } = await supabaseClient
          .from('transactions')
          .select('*, categories(name, kind, color)')
          .order('txn_date', { ascending: false });

        let loadedTxns = [];
        if (!error && txns) {
          loadedTxns = txns
            .filter(t => !t.is_sample && !t.id?.startsWith('sample-'))
            .map(t => ({
              ...t,
              category_name: t.categories?.name || t.category_name || 'Uncategorised'
            }));
        }

        // AUTO-SYNC: If user has local transactions from previous session not yet in Supabase, sync them!
        const localTxnsRaw = localStorage.getItem(`finpilot_txns_${userId}`) || localStorage.getItem('finpilot_txns');
        if (localTxnsRaw) {
          try {
            const localTxns = JSON.parse(localTxnsRaw);
            if (Array.isArray(localTxns) && localTxns.length > 0) {
              const existingHashes = new Set(loadedTxns.map(t => t.hash));
              const missingInDb = localTxns.filter(t => !t.is_sample && (!t.hash || !existingHashes.has(t.hash)));

              if (missingInDb.length > 0) {
                console.log(`[API] Auto-syncing ${missingInDb.length} local entries to Supabase table...`);
                const payloads = missingInDb.map(t => ({
                  user_id: userId,
                  txn_date: t.txn_date,
                  merchant: t.merchant,
                  description: t.description || t.merchant,
                  amount: t.amount,
                  category_source: 'user',
                  hash: t.hash || `${t.txn_date}_${t.amount}_${t.description}`
                }));

                const { data: inserted, error: syncErr } = await supabaseClient
                  .from('transactions')
                  .insert(payloads)
                  .select('*, categories(name, kind, color)');

                if (!syncErr && inserted) {
                  const newItems = inserted.map(t => ({
                    ...t,
                    category_name: t.categories?.name || t.category_name || 'Uncategorised'
                  }));
                  loadedTxns = [...newItems, ...loadedTxns];
                  console.log(`[API] Synced ${inserted.length} transactions directly into Supabase!`);
                }
              }
            }
          } catch (syncE) {
            console.warn('[API] Auto-sync error:', syncE);
          }
        }

        state.setTransactions(loadedTxns, false);
        localStorage.setItem(`finpilot_txns_${userId}`, JSON.stringify(loadedTxns));
        localStorage.setItem('finpilot_txns', JSON.stringify(loadedTxns));

        // Goals Loading & Auto-Sync
        const { data: goals } = await supabaseClient.from('goals').select('*');
        let loadedGoals = goals || [];

        const localGoalsRaw = localStorage.getItem(`finpilot_goals_${userId}`) || localStorage.getItem('finpilot_goals');
        if (localGoalsRaw) {
          try {
            const localGoals = JSON.parse(localGoalsRaw);
            if (Array.isArray(localGoals) && localGoals.length > 0) {
              const existingGoalNames = new Set(loadedGoals.map(g => g.name?.toLowerCase()));
              const missingGoals = localGoals.filter(g => !existingGoalNames.has(g.name?.toLowerCase()));
              if (missingGoals.length > 0) {
                const goalPayloads = missingGoals.map(g => ({
                  user_id: userId,
                  name: g.name,
                  target_amount: g.target_amount,
                  current_amount: g.current_amount || 0,
                  target_date: g.target_date || null
                }));
                const { data: insertedGoals } = await supabaseClient.from('goals').insert(goalPayloads).select();
                if (insertedGoals) {
                  loadedGoals = [...insertedGoals, ...loadedGoals];
                }
              }
            }
          } catch (goalSyncE) {
            console.warn('[API] Goal sync error:', goalSyncE);
          }
        }

        state.setGoals(loadedGoals);
        localStorage.setItem(`finpilot_goals_${userId}`, JSON.stringify(loadedGoals));
        localStorage.setItem('finpilot_goals', JSON.stringify(loadedGoals));

      } catch (err) {
        console.warn('[API] Supabase load error, falling back to local storage:', err);
        this.loadLocalUserData(userId);
      }
    } else {
      // Local demo accounts: load from LocalStorage
      this.loadLocalUserData(userId);
    }

    // Sync state with server backend so chatbot has immediate access
    await this.syncDemoState();
  },

  loadLocalUserData(userId) {
    state.setCategories(DEFAULT_CATEGORIES);

    const localTxns = localStorage.getItem(`finpilot_txns_${userId}`) || localStorage.getItem('finpilot_txns');
    if (localTxns !== null) {
      try {
        const parsed = JSON.parse(localTxns);
        if (Array.isArray(parsed)) {
          // Strictly filter out any sample data - only keep real user-inputted transactions!
          const userOnly = parsed.filter(t => !t.is_sample && !t.id?.startsWith('sample-'));
          state.setTransactions(userOnly, false);
          localStorage.setItem(`finpilot_txns_${userId}`, JSON.stringify(userOnly));
          localStorage.setItem('finpilot_txns', JSON.stringify(userOnly));
        } else {
          state.setTransactions([], false);
        }
      } catch {
        state.setTransactions([], false);
      }
    } else {
      state.setTransactions([], false);
      localStorage.setItem(`finpilot_txns_${userId}`, JSON.stringify([]));
    }

    const localGoals = localStorage.getItem(`finpilot_goals_${userId}`) || localStorage.getItem('finpilot_goals');
    if (localGoals !== null) {
      try {
        state.setGoals(JSON.parse(localGoals) || []);
      } catch {
        state.setGoals([]);
      }
    } else {
      state.setGoals([]);
      localStorage.setItem(`finpilot_goals_${userId}`, JSON.stringify([]));
    }
  },

  seedDefaultGoals() {
    const userId = state.currentUser?.id || 'demo-user-1';
    const goals = [
      { id: 'g-1', name: 'Emergency Fund (6 Months)', target_amount: 300000, current_amount: 110000, target_date: '2026-12-31' },
      { id: 'g-2', name: 'New Laptop & Workspace', target_amount: 120000, current_amount: 45000, target_date: '2026-11-30' }
    ];
    state.setGoals(goals);
    localStorage.setItem(`finpilot_goals_${userId}`, JSON.stringify(goals));
    localStorage.setItem('finpilot_goals', JSON.stringify(goals));
  },

  /**
   * Load sample transactions from embedded dataset with zero network latency
   */
  async loadSampleData() {
    const userId = state.currentUser?.id || 'demo-user-1';
    try {
      if (Array.isArray(SAMPLE_TRANSACTIONS) && SAMPLE_TRANSACTIONS.length > 0) {
        const txns = SAMPLE_TRANSACTIONS.map((t, idx) => ({
          ...t,
          id: `sample-${userId}-${idx + 1}`
        }));
        state.setTransactions(txns, true);
        localStorage.setItem(`finpilot_txns_${userId}`, JSON.stringify(txns));
        localStorage.setItem('finpilot_txns', JSON.stringify(txns));
        await this.syncDemoState();
        return txns;
      }
    } catch (err) {
      console.warn('[API] Embedded sample load fallback to CSV fetch:', err);
    }

    try {
      const res = await fetch('/sample/sample_transactions.csv');
      const csvText = await res.text();
      let parsedRows = [];
      if (typeof window !== 'undefined' && window.Papa && typeof window.Papa.parse === 'function') {
        const parsed = window.Papa.parse(csvText, { header: true, skipEmptyLines: true, dynamicTyping: true });
        parsedRows = parsed.data || [];
      } else {
        const { parseCSV } = await import('../../shared/engine.js');
        const parsed = parseCSV(csvText);
        parsedRows = parsed.rows;
      }

      const txns = parsedRows.map((row, idx) => ({
        id: `sample-${userId}-${idx + 1}`,
        txn_date: row.Date || row.date,
        description: row.Description || row.description,
        merchant: row.Merchant || row.merchant,
        amount: Number(row.Amount || row.amount),
        category_name: row.Category || row.category || 'Uncategorised',
        is_sample: true,
        hash: `${row.Date}_${row.Amount}_${row.Description}`
      }));

      state.setTransactions(txns, true);
      localStorage.setItem(`finpilot_txns_${userId}`, JSON.stringify(txns));
      localStorage.setItem('finpilot_txns', JSON.stringify(txns));
      await this.syncDemoState();
      return txns;
    } catch (err) {
      console.error('[API] Failed to load sample transactions:', err);
      return [];
    }
  },

  /**
   * Sync active transactions and goals to backend server demoStore
   */
  async syncDemoState() {
    try {
      const userId = state.currentUser?.id || 'demo-user-1';
      const userEmail = state.currentUser?.email || 'demo@finpilot.local';
      await fetch('/api/demo/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${state.getUserToken()}`,
          'X-User-Id': userId,
          'X-User-Email': userEmail
        },
        body: JSON.stringify({
          userId,
          transactions: state.transactions,
          categories: state.categories,
          goals: state.goals,
          rules: state.categoryRules,
          flags: state.flags
        })
      });
    } catch (err) {
      console.warn('[API] Demo sync notice:', err.message);
    }
  },

  /**
   * Save category correction for a transaction, and optionally learn it as a category_rule
   */
  async updateTransactionCategory(txnId, newCategory, applyToAllMerchant = false, merchantName = '') {
    // 1. Update in local state
    const target = state.transactions.find(t => t.id === txnId);
    if (!target) return;

    const oldCategory = target.category_name;
    target.category_name = newCategory;
    target.category_source = 'user';

    let affectedCount = 1;

    // Apply to all other transactions for this merchant if requested
    if (applyToAllMerchant && merchantName) {
      for (const t of state.transactions) {
        if ((t.merchant || '').toLowerCase() === merchantName.toLowerCase()) {
          t.category_name = newCategory;
          t.category_source = 'user';
          affectedCount++;
        }
      }

      // Add to category rules
      state.categoryRules.push({
        id: 'rule-' + Date.now(),
        merchant_pattern: merchantName.toLowerCase(),
        category_name: newCategory
      });
    }

    state.setTransactions([...state.transactions], state.isSampleData);
    localStorage.setItem('finpilot_txns', JSON.stringify(state.transactions));
    await this.syncDemoState();

    return { oldCategory, newCategory, affectedCount };
  },

  /**
   * Call AI Copilot /api/chat
   */
  async sendChatMessage(message, history = []) {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.getUserToken()}`
      },
      body: JSON.stringify({ message, history })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(err.error || `Error ${res.status}: ${res.statusText}`);
    }

    return await res.json();
  }
};
