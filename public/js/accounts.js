// public/js/accounts.js
// Multi-user account management system with profile switcher, data isolation, and sample data population

import { state } from './state.js';
import { api } from './api.js';
import { showToast, formatINR } from './ui.js';
import { SAMPLE_TRANSACTIONS } from '../../shared/sample_data.js';

export const accounts = {
  getAccounts() {
    try {
      const list = JSON.parse(localStorage.getItem('finpilot_saved_accounts') || '[]');
      if (!Array.isArray(list) || list.length === 0) {
        // Initialize with default demo account
        const defaultDemo = {
          id: 'demo-user-1',
          name: 'Demo User',
          email: 'demo@finpilot.local',
          role: 'Educational Demo',
          avatar: 'D',
          created_at: '2026-05-01T00:00:00Z',
          is_anonymous: true
        };
        localStorage.setItem('finpilot_saved_accounts', JSON.stringify([defaultDemo]));
        return [defaultDemo];
      }
      return list;
    } catch {
      return [];
    }
  },

  saveAccount(acc) {
    const list = this.getAccounts();
    const idx = list.findIndex(a => a.id === acc.id || a.email.toLowerCase() === acc.email.toLowerCase());
    if (idx >= 0) {
      list[idx] = { ...list[idx], ...acc };
    } else {
      list.push(acc);
    }
    localStorage.setItem('finpilot_saved_accounts', JSON.stringify(list));
  },

  getCurrentUser() {
    return state.currentUser;
  },

  async switchAccount(targetUserId) {
    const list = this.getAccounts();
    const target = list.find(a => a.id === targetUserId);
    if (!target) return false;

    state.currentUser = {
      id: target.id,
      name: target.name,
      email: target.email,
      token: 'session-' + target.id,
      isAnonymous: target.is_anonymous || false
    };
    localStorage.setItem('finpilot_user', JSON.stringify(state.currentUser));

    // Load target account's isolated data
    await api.loadUserData();

    // Close modal if open
    document.getElementById('modal-account-profile')?.classList.remove('open');

    showToast(`Switched account to: ${target.name || target.email}`);
    updateUserBadgeUI();
    return true;
  },

  async seedSampleDataForCurrentUser() {
    // Clone sample transactions with fresh IDs for this account
    const txns = SAMPLE_TRANSACTIONS.map((t, idx) => ({
      ...t,
      id: `txn-${state.currentUser.id}-${idx + 1}`
    }));

    state.setTransactions(txns, true);
    localStorage.setItem(`finpilot_txns_${state.currentUser.id}`, JSON.stringify(txns));
    localStorage.setItem('finpilot_txns', JSON.stringify(txns));

    await api.syncDemoState();
    showToast(`Loaded ${txns.length} transactions for ${state.currentUser.name || state.currentUser.email}!`);
  },

  async clearDataForCurrentUser() {
    if (!confirm('Are you sure you want to clear all data and start fresh with your own records?')) return;

    state.setTransactions([], false);
    state.setGoals([]);
    const uid = state.currentUser?.id || 'demo-user-1';
    localStorage.removeItem(`finpilot_txns_${uid}`);
    localStorage.removeItem(`finpilot_goals_${uid}`);
    localStorage.removeItem('finpilot_txns');
    localStorage.removeItem('finpilot_goals');

    if (state.currentUser) {
      state.currentUser.isSample = false;
    }

    await api.syncDemoState();
    showToast('All data cleared. You have a fresh slate to record your finances!');
  }
};

export function initAccountModal() {
  // Clicking sidebar user badge opens Account modal
  document.getElementById('user-badge-sidebar')?.addEventListener('click', openAccountModal);
  document.getElementById('btn-header-profile')?.addEventListener('click', openAccountModal);

  // Close modal buttons
  document.getElementById('btn-close-account-modal')?.addEventListener('click', () => {
    document.getElementById('modal-account-profile')?.classList.remove('open');
  });

  document.getElementById('btn-account-clear-data')?.addEventListener('click', async () => {
    await accounts.clearDataForCurrentUser();
    renderAccountModal();
  });

  document.getElementById('btn-account-switch')?.addEventListener('change', async (e) => {
    const selectedId = e.target.value;
    if (selectedId) {
      await accounts.switchAccount(selectedId);
      renderAccountModal();
    }
  });

  document.getElementById('btn-account-signout')?.addEventListener('click', async () => {
    await api.signOut();
  });
}

export function openAccountModal() {
  const modal = document.getElementById('modal-account-profile');
  if (!modal) return;
  renderAccountModal();
  modal.classList.add('open');
}

export function renderAccountModal() {
  const user = state.currentUser || { name: 'User', email: 'guest@finpilot.local' };
  const allAccounts = accounts.getAccounts();

  const nameEl = document.getElementById('acc-modal-name');
  const emailEl = document.getElementById('acc-modal-email');
  const avatarEl = document.getElementById('acc-modal-avatar');
  const roleEl = document.getElementById('acc-modal-role');
  const countEl = document.getElementById('acc-modal-tx-count');
  const sumEl = document.getElementById('acc-modal-tx-total');
  const selectEl = document.getElementById('btn-account-switch');

  const displayName = user.name || user.email?.split('@')[0] || 'User';

  if (nameEl) nameEl.textContent = displayName;
  if (emailEl) emailEl.textContent = user.email || 'guest@finpilot.local';
  if (avatarEl) avatarEl.textContent = displayName[0].toUpperCase();
  if (roleEl) roleEl.textContent = user.isAnonymous ? 'Guest Demo Account' : 'Secured User Account';

  if (countEl) countEl.textContent = `${state.transactions.length} records`;

  const totalSpent = state.transactions
    .filter(t => Number(t.amount) < 0)
    .reduce((sum, t) => sum + Math.abs(Number(t.amount)), 0);
  if (sumEl) sumEl.textContent = formatINR(totalSpent);

  // Populate account switcher dropdown
  if (selectEl) {
    selectEl.innerHTML = allAccounts.map(a =>
      `<option value="${a.id}" ${a.id === user.id ? 'selected' : ''}>${a.name || a.email} (${a.email})</option>`
    ).join('') + `<option value="new">+ Create Another Account...</option>`;

    selectEl.onchange = async (e) => {
      if (e.target.value === 'new') {
        window.location.href = 'login.html';
      } else {
        await accounts.switchAccount(e.target.value);
      }
    };
  }
}

export function updateUserBadgeUI() {
  const user = state.currentUser;
  if (!user) return;

  const emailEl = document.getElementById('user-display-email');
  const roleEl = document.getElementById('user-display-role');
  const initialEl = document.getElementById('user-avatar-initial');
  const headerUserEl = document.getElementById('btn-header-username');

  const displayName = user.name || user.email?.split('@')[0] || 'User';

  if (emailEl) emailEl.textContent = user.email || 'demo@finpilot.local';
  if (roleEl) roleEl.textContent = user.isAnonymous ? 'Guest Demo Session' : 'Secured User Account';
  if (initialEl) {
    if (user.avatarUrl) {
      initialEl.innerHTML = `<img src="${user.avatarUrl}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;" alt="${displayName}">`;
    } else {
      initialEl.textContent = displayName[0].toUpperCase();
    }
  }
  if (headerUserEl) headerUserEl.textContent = displayName;
}
