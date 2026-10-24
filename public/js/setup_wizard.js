// public/js/setup_wizard.js
// Onboarding and quick personal financial baseline configuration for new users
// Allows users to dynamically add, edit, and remove their income and expenses in the Blur View Modal & Dashboard

import { state } from './state.js';
import { api } from './api.js';
import { showToast, formatINR } from './ui.js';
import { renderIcons } from './icons.js';

export function initSetupWizard() {
  // Listen for state changes to refresh onboarding cards
  state.subscribe((event) => {
    if (event === 'transactions:updated' || event === 'goals:updated' || event === 'auth:state_changed') {
      updateOnboardingUI();
    }
  });

  // 1. Add Income button in Dashboard Card
  document.getElementById('btn-onboarding-add-income')?.addEventListener('click', () => {
    const modal = document.getElementById('modal-add-transaction');
    if (modal) {
      modal.classList.add('open');
      const typeSelect = document.getElementById('add-tx-type');
      const catSelect = document.getElementById('add-tx-category');
      const merchantInput = document.getElementById('add-tx-merchant');
      const amountInput = document.getElementById('add-tx-amount');

      if (typeSelect) typeSelect.value = 'income';
      if (catSelect) catSelect.value = 'Salary';
      if (merchantInput) merchantInput.value = 'Monthly Payroll Salary';
      if (amountInput) {
        amountInput.value = '';
        amountInput.focus();
      }
    }
  });

  // 4. Add Expense button in Dashboard Card
  document.getElementById('btn-onboarding-add-expense')?.addEventListener('click', () => {
    const modal = document.getElementById('modal-add-transaction');
    if (modal) {
      modal.classList.add('open');
      const typeSelect = document.getElementById('add-tx-type');
      const catSelect = document.getElementById('add-tx-category');
      const merchantInput = document.getElementById('add-tx-merchant');
      const amountInput = document.getElementById('add-tx-amount');

      if (typeSelect) typeSelect.value = 'expense';
      if (catSelect) catSelect.value = 'Dining';
      if (merchantInput) {
        merchantInput.value = '';
        merchantInput.focus();
      }
      if (amountInput) amountInput.value = '';
    }
  });

  // 5. Add Goal button in Dashboard Card
  document.getElementById('btn-onboarding-add-goal')?.addEventListener('click', () => {
    const modal = document.getElementById('modal-create-goal');
    if (modal) {
      modal.classList.add('open');
      const dateInput = document.getElementById('goal-input-date');
      if (dateInput) {
        const target = new Date();
        target.setMonth(target.getMonth() + 6);
        dateInput.value = target.toISOString().slice(0, 10);
      }
      document.getElementById('goal-input-name')?.focus();
    }
  });

  // 6. Close & Cancel Quick Setup Wizard Modal
  const handleDismissModal = () => {
    closeQuickSetupModal();
    const userId = state.currentUser?.id || 'demo-user-1';
    localStorage.setItem(`finpilot_setup_seen_${userId}`, 'true');
  };

  document.getElementById('btn-close-quick-setup')?.addEventListener('click', handleDismissModal);
  document.getElementById('btn-cancel-quick-setup')?.addEventListener('click', handleDismissModal);

  // 7. Dynamic "+ Add Income" inside Setup Modal
  document.getElementById('btn-setup-add-income-row')?.addEventListener('click', () => {
    const container = document.getElementById('setup-income-items-container');
    if (container) {
      const row = createIncomeRow('', '');
      container.appendChild(row);
      renderIcons();
      row.querySelector('.setup-income-desc')?.focus();
      updateLiveNetSummary();
    }
  });

  // 8. Dynamic "+ Add Expense" inside Setup Modal
  document.getElementById('btn-setup-add-expense-row')?.addEventListener('click', () => {
    const container = document.getElementById('setup-expense-items-container');
    if (container) {
      const row = createExpenseRow('Dining', '', '');
      container.appendChild(row);
      renderIcons();
      row.querySelector('.setup-expense-merchant')?.focus();
      updateLiveNetSummary();
    }
  });

  // 9. Clear Goal inside Setup Modal
  document.getElementById('btn-setup-clear-goal')?.addEventListener('click', () => {
    const nameInp = document.getElementById('setup-goal-name');
    const targetInp = document.getElementById('setup-goal-target');
    if (nameInp) nameInp.value = '';
    if (targetInp) targetInp.value = '';
    showToast('Savings goal cleared.');
  });

  // 10. Auto-Fill Typical Baseline Numbers (1-Click Shortcut)
  document.getElementById('btn-quick-setup-autofill')?.addEventListener('click', () => {
    populateDefaultSetupRows();
    showToast('✨ Auto-filled typical monthly baseline! Add or remove any items as needed.');
  });

  // 11. 50/30/20 Proportions Split
  document.getElementById('btn-quick-setup-calc-proportions')?.addEventListener('click', () => {
    let firstIncome = 0;
    const firstIncInput = document.querySelector('.setup-income-amount');
    if (firstIncInput) {
      firstIncome = Number(firstIncInput.value) || 0;
    }
    if (firstIncome <= 0) {
      firstIncome = 65000;
      if (firstIncInput) firstIncInput.value = '65000';
    }

    const expContainer = document.getElementById('setup-expense-items-container');
    if (expContainer) {
      expContainer.innerHTML = '';
      expContainer.appendChild(createExpenseRow('Rent/Housing', 'Apartment Rent (30%)', String(Math.round(firstIncome * 0.30))));
      expContainer.appendChild(createExpenseRow('Groceries', 'Groceries & Food (15%)', String(Math.round(firstIncome * 0.15))));
      expContainer.appendChild(createExpenseRow('Utilities', 'Utilities & Bills (6%)', String(Math.round(firstIncome * 0.06))));
      expContainer.appendChild(createExpenseRow('Dining', 'Dining & Leisure (8%)', String(Math.round(firstIncome * 0.08))));
      renderIcons();
      updateLiveNetSummary();
    }

    const goalTarget = document.getElementById('setup-goal-target');
    if (goalTarget) goalTarget.value = String(Math.round(firstIncome * 3));

    showToast(`⚡ Estimated baseline according to 50/30/20 proportions for ${formatINR(firstIncome)}!`);
  });

  // 12. Handle Quick Setup Wizard Form Submit (Permanent Storage)
  document.getElementById('form-quick-setup')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    await handleQuickSetupSubmit();
  });

  // Initial UI render
  updateOnboardingUI();
}

/**
 * Creates a dynamic Income row with description, amount, and delete button
 */
function createIncomeRow(desc = '', amount = '') {
  const row = document.createElement('div');
  row.className = 'setup-income-row';
  row.style.cssText = 'display: flex; gap: 8px; align-items: center; background-color: var(--bg-surface-elevated); padding: 8px 10px; border: 1px solid var(--border-subtle); border-radius: var(--radius-sm);';
  row.innerHTML = `
    <div style="flex: 2;">
      <input type="text" class="input setup-income-desc" placeholder="Source (e.g. Salary, Freelance)" value="${escapeHtml(desc)}" style="height: 34px; font-size: var(--text-xs);" required>
    </div>
    <div style="flex: 1.5; position: relative;">
      <span style="position: absolute; left: 8px; top: 8px; font-size: 11px; color: var(--text-muted);">₹</span>
      <input type="number" class="input setup-income-amount" placeholder="Amount" value="${amount}" min="1" step="100" style="height: 34px; padding-left: 20px; font-size: var(--text-xs);" required>
    </div>
    <button type="button" class="btn btn-ghost btn-sm btn-remove-setup-row" title="Remove income source" style="padding: 4px; color: var(--accent-expense); height: 34px; width: 34px;">
      <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
    </button>
  `;

  row.querySelector('.btn-remove-setup-row')?.addEventListener('click', () => {
    row.remove();
    updateLiveNetSummary();
  });

  row.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('input', updateLiveNetSummary);
  });

  return row;
}

/**
 * Creates a dynamic Expense row with category, merchant, amount, and delete button
 */
function createExpenseRow(category = 'Dining', merchant = '', amount = '') {
  const categories = [
    { id: 'Rent/Housing', label: 'Rent / Housing' },
    { id: 'Groceries', label: 'Groceries' },
    { id: 'Utilities', label: 'Utilities & WiFi' },
    { id: 'Dining', label: 'Dining & Food' },
    { id: 'Shopping', label: 'Shopping' },
    { id: 'Entertainment', label: 'Entertainment' },
    { id: 'Transport', label: 'Transport / Fuel' },
    { id: 'Healthcare', label: 'Healthcare' },
    { id: 'Subscriptions', label: 'Subscriptions' },
    { id: 'Other', label: 'Other' }
  ];

  const row = document.createElement('div');
  row.className = 'setup-expense-row';
  row.style.cssText = 'display: flex; gap: 8px; align-items: center; background-color: var(--bg-surface-elevated); padding: 8px 10px; border: 1px solid var(--border-subtle); border-radius: var(--radius-sm);';
  
  const optionsHtml = categories.map(c => 
    `<option value="${c.id}" ${c.id === category ? 'selected' : ''}>${c.label}</option>`
  ).join('');

  row.innerHTML = `
    <div style="flex: 1.5;">
      <select class="select setup-expense-category" style="height: 34px; font-size: var(--text-xs); padding: 4px 8px;">
        ${optionsHtml}
      </select>
    </div>
    <div style="flex: 2;">
      <input type="text" class="input setup-expense-merchant" placeholder="Description / Merchant" value="${escapeHtml(merchant)}" style="height: 34px; font-size: var(--text-xs);" required>
    </div>
    <div style="flex: 1.5; position: relative;">
      <span style="position: absolute; left: 8px; top: 8px; font-size: 11px; color: var(--text-muted);">₹</span>
      <input type="number" class="input setup-expense-amount" placeholder="Amount" value="${amount}" min="1" step="50" style="height: 34px; padding-left: 20px; font-size: var(--text-xs);" required>
    </div>
    <button type="button" class="btn btn-ghost btn-sm btn-remove-setup-row" title="Remove expense" style="padding: 4px; color: var(--accent-expense); height: 34px; width: 34px;">
      <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
    </button>
  `;

  row.querySelector('.btn-remove-setup-row')?.addEventListener('click', () => {
    row.remove();
    updateLiveNetSummary();
  });

  row.querySelectorAll('input, select').forEach(inp => {
    inp.addEventListener('input', updateLiveNetSummary);
    inp.addEventListener('change', updateLiveNetSummary);
  });

  return row;
}

/**
 * Calculates live net summary inside setup modal
 */
function updateLiveNetSummary() {
  let totalIncome = 0;
  document.querySelectorAll('.setup-income-amount').forEach(inp => {
    totalIncome += Math.abs(Number(inp.value) || 0);
  });

  let totalExpense = 0;
  document.querySelectorAll('.setup-expense-amount').forEach(inp => {
    totalExpense += Math.abs(Number(inp.value) || 0);
  });

  const net = totalIncome - totalExpense;

  const liveIncomeEl = document.getElementById('setup-live-income');
  const liveExpenseEl = document.getElementById('setup-live-expense');
  const liveNetEl = document.getElementById('setup-live-net');

  if (liveIncomeEl) liveIncomeEl.textContent = formatINR(totalIncome);
  if (liveExpenseEl) liveExpenseEl.textContent = formatINR(totalExpense);
  if (liveNetEl) {
    liveNetEl.textContent = `${net >= 0 ? '+' : ''}${formatINR(net)} / month`;
    liveNetEl.style.color = net >= 0 ? 'var(--accent-teal)' : 'var(--accent-expense)';
  }
}

/**
 * Populates realistic initial rows in the setup modal
 */
export function populateDefaultSetupRows() {
  const incContainer = document.getElementById('setup-income-items-container');
  const expContainer = document.getElementById('setup-expense-items-container');
  if (!incContainer || !expContainer) return;

  incContainer.innerHTML = '';
  expContainer.innerHTML = '';

  incContainer.appendChild(createIncomeRow('Monthly Take-Home Salary', '65000'));

  expContainer.appendChild(createExpenseRow('Rent/Housing', 'Apartment Rent', '20000'));
  expContainer.appendChild(createExpenseRow('Groceries', 'Supermarket & Groceries', '9000'));
  expContainer.appendChild(createExpenseRow('Utilities', 'Electricity & Broadband', '3500'));
  expContainer.appendChild(createExpenseRow('Dining', 'Dining & Outings', '4500'));

  const goalName = document.getElementById('setup-goal-name');
  const goalTarget = document.getElementById('setup-goal-target');
  if (goalName) goalName.value = 'Emergency Fund';
  if (goalTarget) goalTarget.value = '150000';

  renderIcons();
  updateLiveNetSummary();
}

/**
 * Open the Quick Setup Wizard Modal (Blur View)
 */
export function openQuickSetupModal() {
  const modal = document.getElementById('modal-quick-setup');
  if (!modal) return;

  const incContainer = document.getElementById('setup-income-items-container');
  if (incContainer && incContainer.children.length === 0) {
    populateDefaultSetupRows();
  }

  modal.classList.add('open');
  renderIcons();
}

/**
 * Close the Quick Setup Wizard Modal
 */
export function closeQuickSetupModal() {
  const modal = document.getElementById('modal-quick-setup');
  if (modal) modal.classList.remove('open');
}

/**
 * Handle Wizard Submission & Save Permanently
 */
async function handleQuickSetupSubmit() {
  const todayStr = new Date().toISOString().slice(0, 10);
  const createdTxns = [];

  // 1. Gather all Income rows
  document.querySelectorAll('.setup-income-row').forEach(row => {
    const desc = row.querySelector('.setup-income-desc')?.value.trim() || 'Income';
    const amt = Math.abs(Number(row.querySelector('.setup-income-amount')?.value || 0));
    if (amt > 0) {
      createdTxns.push({
        txn_date: todayStr,
        merchant: desc,
        description: desc,
        amount: amt,
        category_name: 'Salary',
        category_source: 'user'
      });
    }
  });

  // 2. Gather all Expense rows
  document.querySelectorAll('.setup-expense-row').forEach(row => {
    const cat = row.querySelector('.setup-expense-category')?.value || 'Dining';
    const merchant = row.querySelector('.setup-expense-merchant')?.value.trim() || cat;
    const amt = Math.abs(Number(row.querySelector('.setup-expense-amount')?.value || 0));
    if (amt > 0) {
      createdTxns.push({
        txn_date: todayStr,
        merchant: merchant,
        description: merchant,
        amount: -amt,
        category_name: cat,
        category_source: 'user'
      });
    }
  });

  if (createdTxns.length === 0) {
    alert('Please enter at least one income or expense item.');
    return;
  }

  // 3. Optional Savings Goal
  const goalTargetVal = Math.abs(Number(document.getElementById('setup-goal-target')?.value || 0));
  const goalNameVal = document.getElementById('setup-goal-name')?.value.trim() || 'Emergency Fund';

  if (goalTargetVal > 0) {
    const targetDate = new Date();
    targetDate.setMonth(targetDate.getMonth() + 6);
    const newGoal = {
      name: goalNameVal,
      target_amount: goalTargetVal,
      current_amount: Math.round(goalTargetVal * 0.15),
      target_date: targetDate.toISOString().slice(0, 10)
    };
    await api.addGoal(newGoal);
  }

  // Save all created transactions in batch (atomic & permanent)
  await api.addTransactions(createdTxns);

  // Mark setup as permanently completed for this user
  const userId = state.currentUser?.id || 'demo-user-1';
  localStorage.setItem(`finpilot_setup_completed_${userId}`, 'true');
  localStorage.setItem(`finpilot_setup_seen_${userId}`, 'true');
  localStorage.setItem('finpilot_first_run_seen', 'true');

  closeQuickSetupModal();
  showToast('🎉 Your personal finances are permanently saved! Dashboard updated.');
  updateOnboardingUI();
}

/**
 * Render Onboarding Banner on Dashboard and lists of added user entries
 */
export function updateOnboardingUI() {
  const emptyBanner = document.getElementById('dashboard-empty-banner');
  const sampleBadge = document.getElementById('sample-data-badge');
  if (sampleBadge) sampleBadge.style.display = 'none';

  if (!emptyBanner) return;

  // Always keep the 3-column personal setup card on the dashboard
  emptyBanner.style.display = 'block';

  // 1. Update Display Name
  const nameEl = document.getElementById('onboarding-user-name');
  if (nameEl) {
    const user = state.currentUser;
    const name = user?.name || user?.displayName || (user?.email ? user.email.split('@')[0] : 'Friend');
    nameEl.textContent = name;
  }

  // 2. Render Column 1: Income Items
  const incomeListEl = document.getElementById('onboarding-income-list');
  if (incomeListEl) {
    const incomeTxns = state.transactions.filter(t => Number(t.amount) > 0);
    if (incomeTxns.length === 0) {
      incomeListEl.innerHTML = `
        <div style="text-align: center; padding: 12px 6px; color: var(--text-muted); font-size: 11px; font-style: italic;">
          No income recorded yet. Click above to add your salary or earnings.
        </div>
      `;
    } else {
      incomeListEl.innerHTML = incomeTxns.slice(0, 8).map(t => `
        <div class="onboarding-item-row" style="display: flex; align-items: center; justify-content: space-between; padding: 6px 10px; background-color: var(--bg-surface-elevated); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); font-size: var(--text-xs);">
          <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 130px;">
            <div style="font-weight: 600; color: var(--text-primary); text-overflow: ellipsis; overflow: hidden;">${escapeHtml(t.merchant || t.description || 'Income')}</div>
            <div style="font-size: 10px; color: var(--text-muted);">${formatDate(t.txn_date)}</div>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-weight: 700; color: var(--accent-income); font-size: 11px;">+${formatINR(t.amount)}</span>
            <button type="button" class="btn btn-ghost btn-sm btn-del-onboarding-tx" data-id="${t.id}" title="Remove this income item" style="padding: 2px 4px; color: var(--accent-expense);">
              <i data-lucide="trash-2" style="width: 12px; height: 12px;"></i>
            </button>
          </div>
        </div>
      `).join('');
    }
  }

  // 3. Render Column 2: Expense Items
  const expenseListEl = document.getElementById('onboarding-expense-list');
  if (expenseListEl) {
    const expenseTxns = state.transactions.filter(t => Number(t.amount) < 0);
    if (expenseTxns.length === 0) {
      expenseListEl.innerHTML = `
        <div style="text-align: center; padding: 12px 6px; color: var(--text-muted); font-size: 11px; font-style: italic;">
          No expenses recorded yet. Click above to add rent, food, or bills.
        </div>
      `;
    } else {
      expenseListEl.innerHTML = expenseTxns.slice(0, 8).map(t => `
        <div class="onboarding-item-row" style="display: flex; align-items: center; justify-content: space-between; padding: 6px 10px; background-color: var(--bg-surface-elevated); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); font-size: var(--text-xs);">
          <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 130px;">
            <div style="font-weight: 600; color: var(--text-primary); text-overflow: ellipsis; overflow: hidden;">${escapeHtml(t.merchant || t.description || 'Expense')}</div>
            <div style="font-size: 10px; color: var(--text-muted);">${escapeHtml(t.category_name || 'Expense')} · ${formatDate(t.txn_date)}</div>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-weight: 700; color: var(--accent-expense); font-size: 11px;">-${formatINR(Math.abs(t.amount))}</span>
            <button type="button" class="btn btn-ghost btn-sm btn-del-onboarding-tx" data-id="${t.id}" title="Remove this expense item" style="padding: 2px 4px; color: var(--accent-expense);">
              <i data-lucide="trash-2" style="width: 12px; height: 12px;"></i>
            </button>
          </div>
        </div>
      `).join('');
    }
  }

  // 4. Render Column 3: Goals Items
  const goalListEl = document.getElementById('onboarding-goal-list');
  if (goalListEl) {
    const goals = state.goals || [];
    if (goals.length === 0) {
      goalListEl.innerHTML = `
        <div style="text-align: center; padding: 12px 6px; color: var(--text-muted); font-size: 11px; font-style: italic;">
          No savings goals set yet. Set a milestone or import bank statement.
        </div>
      `;
    } else {
      goalListEl.innerHTML = goals.slice(0, 8).map(g => `
        <div class="onboarding-item-row" style="display: flex; align-items: center; justify-content: space-between; padding: 6px 10px; background-color: var(--bg-surface-elevated); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); font-size: var(--text-xs);">
          <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 130px;">
            <div style="font-weight: 600; color: var(--text-primary); text-overflow: ellipsis; overflow: hidden;">${escapeHtml(g.name || 'Goal')}</div>
            <div style="font-size: 10px; color: var(--text-muted);">Target: ${formatINR(g.target_amount || 0)}</div>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-weight: 700; color: var(--accent-primary); font-size: 11px;">${formatINR(g.current_amount || 0)}</span>
            <button type="button" class="btn btn-ghost btn-sm btn-del-onboarding-goal" data-id="${g.id}" title="Remove this goal" style="padding: 2px 4px; color: var(--accent-expense);">
              <i data-lucide="trash-2" style="width: 12px; height: 12px;"></i>
            </button>
          </div>
        </div>
      `).join('');
    }
  }

  // 5. Bind delete events for transactions on dashboard card
  emptyBanner.querySelectorAll('.btn-del-onboarding-tx').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-id');
      if (!id) return;
      await api.deleteTransaction(id);
      showToast('Removed entry from dashboard.');
      updateOnboardingUI();
    });
  });

  // 6. Bind delete events for goals on dashboard card
  emptyBanner.querySelectorAll('.btn-del-onboarding-goal').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-id');
      if (!id) return;
      const updated = state.goals.filter(g => g.id !== id);
      state.setGoals(updated);
      const uid = state.currentUser?.id || 'demo-user-1';
      localStorage.setItem(`finpilot_goals_${uid}`, JSON.stringify(updated));
      localStorage.setItem('finpilot_goals', JSON.stringify(updated));
      await api.syncDemoState();
      showToast('Removed savings goal.');
      updateOnboardingUI();
    });
  });

  renderIcons();
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const mIdx = parseInt(parts[1], 10) - 1;
      return `${parseInt(parts[2], 10)} ${months[mIdx] || parts[1]}`;
    }
    return dateStr;
  } catch {
    return dateStr;
  }
}

function escapeHtml(text = '') {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
