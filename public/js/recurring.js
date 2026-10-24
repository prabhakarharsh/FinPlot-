// public/js/recurring.js
// Detects and renders recurring payments, subscriptions, and regular utility bills

import { state } from './state.js';
import { detectRecurring } from '../../shared/engine.js';
import { formatINR, showToast } from './ui.js';
import { renderIcons } from './icons.js';

let dismissedMerchants = new Set();
let confirmedMerchants = new Set();

export function initRecurring() {
  state.subscribe((event) => {
    if (event === 'transactions:updated') {
      renderRecurring();
    }
  });

  renderRecurring();
}

export function renderRecurring() {
  const container = document.getElementById('recurring-list-container');
  if (!container) return;

  const detected = detectRecurring(state.transactions);
  state.recurring = detected;

  // Filter out dismissed
  const visible = detected.filter(d => !dismissedMerchants.has(d.merchant));

  // Compute monthly and yearly totals
  let monthlyTotal = 0;
  visible.forEach(item => {
    if (item.frequency === 'weekly') monthlyTotal += item.avg_amount * 4.33;
    else if (item.frequency === 'bi-weekly') monthlyTotal += item.avg_amount * 2.16;
    else if (item.frequency === 'monthly') monthlyTotal += item.avg_amount;
    else if (item.frequency === 'yearly') monthlyTotal += item.avg_amount / 12;
  });

  const yearlyTotal = monthlyTotal * 12;

  const monthlyEl = document.getElementById('recurring-monthly-total');
  const yearlyEl = document.getElementById('recurring-yearly-total');
  if (monthlyEl) monthlyEl.textContent = formatINR(monthlyTotal);
  if (yearlyEl) yearlyEl.textContent = formatINR(yearlyTotal);

  if (visible.length === 0) {
    container.innerHTML = `
      <div class="col-12" style="text-align: center; padding: 48px; color: var(--text-muted);">
        <i data-lucide="check-circle" style="width: 36px; height: 36px; margin: 0 auto 12px; color: var(--accent-income);"></i>
        <h4 style="font-size: var(--text-base); font-weight: 600;">No recurring payments detected</h4>
        <p style="font-size: var(--text-xs); margin-top: 4px;">Transactions require at least 3 regular occurrences clustering around 7, 14, 30, or 365 days.</p>
      </div>
    `;
    renderIcons();
    return;
  }

  container.innerHTML = visible.map(item => {
    const isConfirmed = confirmedMerchants.has(item.merchant);
    const confPercent = Math.round(item.confidence * 100);

    return `
      <div class="col-6 card" style="display: flex; flex-direction: column; justify-content: space-between; gap: 16px;">
        <div>
          <div style="display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 8px;">
            <div>
              <h4 style="font-size: var(--text-base); font-weight: 700; color: var(--text-primary);">${item.merchant}</h4>
              <span class="badge ${isConfirmed ? 'badge-income' : 'badge-neutral'}" style="margin-top: 4px;">
                ${isConfirmed ? 'Confirmed' : 'Detected Cadence'}
              </span>
            </div>
            <div style="text-align: right;">
              <div style="font-size: var(--text-xl); font-weight: 700; color: var(--text-primary);">${formatINR(item.avg_amount)}</div>
              <div style="font-size: 11px; color: var(--text-muted); text-transform: capitalize;">every ${item.frequency}</div>
            </div>
          </div>

          <!-- Confidence score bar -->
          <div style="margin-top: 10px;">
            <div style="display: flex; justify-content: space-between; font-size: 11px; color: var(--text-muted); margin-bottom: 4px;">
              <span>Cadence Consistency</span>
              <strong>${confPercent}% match</strong>
            </div>
            <div style="height: 6px; background-color: var(--bg-subtle); border-radius: var(--radius-full); overflow: hidden;">
              <div style="width: ${confPercent}%; height: 100%; background: linear-gradient(90deg, var(--accent-primary), var(--accent-teal));"></div>
            </div>
          </div>

          <!-- Metadata -->
          <div style="display: flex; flex-direction: column; gap: 4px; margin-top: 14px; font-size: var(--text-xs); color: var(--text-secondary);">
            <div style="display: flex; justify-content: space-between;">
              <span>Next Expected Due:</span>
              <strong style="color: var(--text-primary); font-family: var(--font-mono);">${item.next_expected}</strong>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span>Annualised Cost:</span>
              <strong>${formatINR(item.avg_amount * (item.frequency === 'monthly' ? 12 : (item.frequency === 'weekly' ? 52 : 1)))}/yr</strong>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span>Supporting History:</span>
              <span>${item.count} recorded payments</span>
            </div>
          </div>
        </div>

        <!-- Action buttons -->
        <div style="display: flex; justify-content: flex-end; gap: 8px; border-top: 1px solid var(--border-subtle); padding-top: 12px;">
          <button class="btn btn-ghost btn-sm btn-dismiss-rec" data-merchant="${item.merchant}">
            <i data-lucide="eye-off" style="width: 12px;"></i> Dismiss
          </button>
          <button class="btn btn-secondary btn-sm btn-confirm-rec" data-merchant="${item.merchant}">
            <i data-lucide="check" style="width: 12px;"></i> ${isConfirmed ? 'Confirmed' : 'Confirm'}
          </button>
        </div>
      </div>
    `;
  }).join('');

  renderIcons();

  // Attach button event listeners
  container.querySelectorAll('.btn-dismiss-rec').forEach(btn => {
    btn.addEventListener('click', () => {
      const merch = btn.getAttribute('data-merchant');
      dismissedMerchants.add(merch);
      showToast(`Dismissed ${merch} from recurring list.`);
      renderRecurring();
    });
  });

  container.querySelectorAll('.btn-confirm-rec').forEach(btn => {
    btn.addEventListener('click', () => {
      const merch = btn.getAttribute('data-merchant');
      confirmedMerchants.add(merch);
      showToast(`Confirmed ${merch} as verified subscription.`);
      renderRecurring();
    });
  });
}
