// public/js/state.js
// Central reactive state management for FinPilot

export const state = {
  currentUser: null,        // { id, email, token, isAnonymous }
  transactions: [],         // [{ id, txn_date, description, merchant, amount, category_name, hash, is_sample }]
  categories: [],           // [{ id, name, kind, color }]
  categoryRules: [],        // [{ id, merchant_pattern, category_name }]
  recurring: [],            // detected recurring items
  flags: [],                // flagged transactions for review
  goals: [],                // user goals
  activePeriod: 'all',      // 'all' | 'this_month' | 'last_month' | 'last_3_months'
  isSampleData: false,
  currency: 'INR',

  // Listeners for reactive updates
  listeners: new Set(),

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  },

  notify(event, payload) {
    for (const listener of this.listeners) {
      try {
        listener(event, payload, this);
      } catch (err) {
        console.error('[State] Listener error:', err);
      }
    }
  },

  setTransactions(txns, isSample = false) {
    this.transactions = Array.isArray(txns) ? txns : [];
    this.isSampleData = isSample;
    this.notify('transactions:updated', { count: this.transactions.length });
  },

  setCategories(cats) {
    this.categories = Array.isArray(cats) ? cats : [];
    this.notify('categories:updated', this.categories);
  },

  setGoals(goals) {
    this.goals = Array.isArray(goals) ? goals : [];
    this.notify('goals:updated', this.goals);
  },

  setActivePeriod(period) {
    this.activePeriod = period;
    this.notify('period:changed', period);
  },

  getUserToken() {
    return this.currentUser?.token || 'guest-demo-token';
  }
};
