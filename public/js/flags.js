// public/js/flags.js
// Neutral anomaly review view (strictly neutral language, never "fraud")

import { state } from './state.js';
import { flagAnomalies } from '../../shared/engine.js';
import { formatINR, showToast } from './ui.js';
import { highlightTransaction } from './transactions.js';
import { renderIcons } from './icons.js';

const flagStatusOverrides = new Map(); // txnId_reasonCode -> 'normal' | 'dismissed' | 'follow_up'

export function initFlags() {
  state.subscribe((event) => {
    if (event === 'transactions:updated') {
      renderFlags();
    }
  });

  renderFlags();
}

export function renderFlags() {
  const container = document.getElementById('flags-list-container');
  if (!container) return;

  const rawFlags = flagAnomalies(state.transactions);
  state.flags = rawFlags;

  // Filter out dismissed or marked normal items
  const activeFlags = rawFlags.filter(f => {
    const key = `${f.txn_id}_${f.reason_code}`;
    const status = flagStatusOverrides.get(key);
    return status !== 'dismissed' && status !== 'normal';
  });

  // Update badge count in sidebar
  const badge = document.getElementById('badge-flag-count');
  if (badge) {
    badge.textContent = activeFlags.length;
    badge.style.display = activeFlags.length > 0 ? 'inline-block' : 'none';
  }

  // Update dashboard banner
  const dashBanner = document.getElementById('dashboard-flags-banner');
  const dashText = document.getElementById('dashboard-flags-text');
  if (dashBanner && dashText) {
    if (activeFlags.length > 0) {
      dashBanner.style.display = 'flex';
      dashText.textContent = `You have ${activeFlags.length} transaction(s) flagged for review.`;
    } else {
      dashBanner.style.display = 'none';
    }
  }

  if (activeFlags.length === 0) {
    container.innerHTML = `
      <div class="card" style="text-align: center; padding: 48px; color: var(--text-muted);">
        <i data-lucide="shield-check" style="width: 44px; height: 44px; margin: 0 auto 12px; color: var(--accent-income);"></i>
        <h4 style="font-size: var(--text-base); font-weight: 600; color: var(--text-primary);">All Clear — No Items Flagged for Review</h4>
        <p style="font-size: var(--text-xs); margin-top: 4px;">Transactions comply with your regular spending patterns and baseline cadence.</p>
      </div>
    `;
    renderIcons();
    return;
  }

  container.innerHTML = activeFlags.map(f => {
    const txn = state.transactions.find(t => t.id === f.txn_id) || {};
    const key = `${f.txn_id}_${f.reason_code}`;
    const status = flagStatusOverrides.get(key) || 'open';

    return `
      <div class="card" style="border-left: 4px solid var(--accent-review);">
        <div style="display: flex; flex-wrap: wrap; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 12px;">
          <div>
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
              <span class="badge badge-review">${f.reason_code.replace(/_/g, ' ')}</span>
              ${status === 'follow_up' ? `<span class="badge" style="background: rgba(239, 68, 68, 0.15); color: var(--accent-expense);">Marked for Follow-up</span>` : ''}
              <span style="font-size: 11px; color: var(--text-muted); font-family: var(--font-mono);">${txn.txn_date || 'Date N/A'}</span>
            </div>
            <h4 style="font-size: var(--text-base); font-weight: 700; color: var(--text-primary);">
              ${txn.merchant || txn.description || 'Transaction'}
            </h4>
          </div>
          
          <div style="text-align: right;">
            <div style="font-size: var(--text-xl); font-weight: 700; color: var(--accent-expense);">
              ${formatINR(txn.amount || 0)}
            </div>
            <button class="btn btn-ghost btn-sm btn-view-txn" data-id="${f.txn_id}" style="font-size: 11px; padding: 2px 6px;">
              <i data-lucide="external-link" style="width: 12px;"></i> View Transaction
            </button>
          </div>
        </div>

        <p style="font-size: var(--text-sm); color: var(--text-secondary); line-height: 1.5; margin-bottom: 16px;">
          ${f.reason_text}
        </p>

        <!-- Neutral review actions -->
        <div style="display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; padding-top: 12px; border-top: 1px solid var(--border-subtle);">
          <button class="btn btn-secondary btn-sm btn-flag-action" data-action="normal" data-key="${key}">
            <i data-lucide="check" style="width: 12px;"></i> This is Normal
          </button>
          <button class="btn btn-outline btn-sm btn-flag-action" data-action="follow_up" data-key="${key}">
            <i data-lucide="bookmark" style="width: 12px;"></i> Follow Up Later
          </button>
          <button class="btn btn-ghost btn-sm btn-flag-action" data-action="dismissed" data-key="${key}">
            <i data-lucide="eye-off" style="width: 12px;"></i> Dismiss
          </button>
        </div>
      </div>
    `;
  }).join('');

  renderIcons();

  // Attach button event handlers
  container.querySelectorAll('.btn-view-txn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      highlightTransaction(id);
    });
  });

  container.querySelectorAll('.btn-flag-action').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.getAttribute('data-action');
      const key = btn.getAttribute('data-key');
      flagStatusOverrides.set(key, action);

      if (action === 'normal') showToast('Marked transaction as expected/normal.');
      else if (action === 'dismissed') showToast('Dismissed review prompt.');
      else if (action === 'follow_up') showToast('Saved to your follow-up list.');

      renderFlags();
    });
  });
}
