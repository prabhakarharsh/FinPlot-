// public/js/transactions.js
// Transactions view with inline category editing, rule learning, filtering, and export

import { state } from './state.js';
import { api } from './api.js';
import { formatINR, showToast } from './ui.js';
import { DEFAULT_CATEGORIES } from '../../shared/constants.js';
import { renderIcons } from './icons.js';

let currentPage = 1;
const pageSize = 25;
let sortField = 'txn_date';
let sortAsc = false;
let selectedTxnIds = new Set();
let pendingDeleteTxnId = null;
let pendingBulkDelete = false;

export function initTransactions() {
  // Populate category filter dropdown
  const filterCatSelect = document.getElementById('tx-category-filter');
  if (filterCatSelect) {
    filterCatSelect.innerHTML = '<option value="">All Categories</option>' +
      DEFAULT_CATEGORIES.map(c => `<option value="${c.name}">${c.name}</option>`).join('');
  }

  // Populate Add Transaction category dropdown
  const addTxCategory = document.getElementById('add-tx-category');
  if (addTxCategory) {
    addTxCategory.innerHTML = DEFAULT_CATEGORIES.map(c => `<option value="${c.name}">${c.name}</option>`).join('');
  }

  // Set default date in Add modal to today
  const addDateInput = document.getElementById('add-tx-date');
  if (addDateInput) {
    addDateInput.value = new Date().toISOString().slice(0, 10);
  }

  // Add Transaction Modal open/close
  const openAddModal = () => {
    const modal = document.getElementById('modal-add-transaction');
    if (modal) {
      modal.classList.add('open');
      document.getElementById('add-tx-merchant')?.focus();
    }
  };

  document.getElementById('btn-add-transaction')?.addEventListener('click', openAddModal);
  document.getElementById('btn-header-add-tx')?.addEventListener('click', openAddModal);
  document.getElementById('btn-dashboard-add-tx')?.addEventListener('click', openAddModal);

  document.getElementById('btn-close-add-tx-modal')?.addEventListener('click', () => {
    document.getElementById('modal-add-transaction')?.classList.remove('open');
  });

  document.getElementById('btn-cancel-add-tx')?.addEventListener('click', () => {
    document.getElementById('modal-add-transaction')?.classList.remove('open');
  });

  // Handle Add Transaction form submission
  document.getElementById('form-add-transaction')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const dateVal = document.getElementById('add-tx-date').value;
    const typeVal = document.getElementById('add-tx-type').value;
    const merchantVal = document.getElementById('add-tx-merchant').value.trim();
    const descVal = document.getElementById('add-tx-desc').value.trim() || merchantVal;
    const rawAmt = Math.abs(Number(document.getElementById('add-tx-amount').value));
    const catVal = document.getElementById('add-tx-category').value;

    if (!dateVal || !merchantVal || isNaN(rawAmt) || rawAmt <= 0) {
      alert('Please fill in all required fields with valid values.');
      return;
    }

    const finalAmount = typeVal === 'income' ? rawAmt : -rawAmt;

    const newTxn = {
      txn_date: dateVal,
      merchant: merchantVal,
      description: descVal,
      amount: finalAmount,
      category_name: catVal
    };

    await api.addTransaction(newTxn);

    document.getElementById('modal-add-transaction')?.classList.remove('open');
    e.target.reset();
    if (addDateInput) addDateInput.value = new Date().toISOString().slice(0, 10);

    showToast(`Added transaction for ${merchantVal} (${formatINR(finalAmount)})!`);
    renderTransactionsTable();
  });

  // Delete Modal cancel / close
  document.getElementById('btn-close-delete-modal')?.addEventListener('click', closeDeleteModal);
  document.getElementById('btn-cancel-delete')?.addEventListener('click', closeDeleteModal);

  // Delete Modal confirm
  document.getElementById('btn-confirm-delete')?.addEventListener('click', async () => {
    if (pendingBulkDelete) {
      const idsToDelete = Array.from(selectedTxnIds);
      const deletedList = await api.deleteTransactions(idsToDelete);
      selectedTxnIds.clear();
      updateBulkActionUI();
      closeDeleteModal();

      showToast(`Deleted ${deletedList.length} transactions.`, {
        actionText: 'Undo',
        onAction: async () => {
          for (const t of deletedList) {
            await api.addTransaction(t);
          }
          showToast(`Restored ${deletedList.length} transactions.`);
          renderTransactionsTable();
        }
      });
    } else if (pendingDeleteTxnId) {
      const deleted = await api.deleteTransaction(pendingDeleteTxnId);
      selectedTxnIds.delete(pendingDeleteTxnId);
      updateBulkActionUI();
      closeDeleteModal();

      if (deleted) {
        showToast(`Deleted ${deleted.merchant || 'transaction'} (${formatINR(deleted.amount)}).`, {
          actionText: 'Undo',
          onAction: async () => {
            await api.addTransaction(deleted);
            showToast(`Restored transaction for ${deleted.merchant}.`);
            renderTransactionsTable();
          }
        });
      }
    }
    renderTransactionsTable();
  });

  // Bulk Delete Button
  document.getElementById('btn-bulk-delete')?.addEventListener('click', () => {
    if (selectedTxnIds.size === 0) return;
    pendingBulkDelete = true;
    pendingDeleteTxnId = null;

    const msg = document.getElementById('delete-confirm-message');
    if (msg) {
      msg.textContent = `Are you sure you want to delete ${selectedTxnIds.size} selected transaction(s)? All metrics, flags, and cash flow will immediately recalculate.`;
    }
    document.getElementById('modal-delete-confirm')?.classList.add('open');
  });

  // Search and filter listeners
  document.getElementById('tx-search-input')?.addEventListener('input', () => {
    currentPage = 1;
    renderTransactionsTable();
  });

  document.getElementById('tx-category-filter')?.addEventListener('change', () => {
    currentPage = 1;
    renderTransactionsTable();
  });

  document.getElementById('tx-type-filter')?.addEventListener('change', () => {
    currentPage = 1;
    renderTransactionsTable();
  });

  // Table header sorting
  document.querySelectorAll('th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const field = th.getAttribute('data-sort');
      if (sortField === field) {
        sortAsc = !sortAsc;
      } else {
        sortField = field;
        sortAsc = false;
      }
      renderTransactionsTable();
    });
  });

  // Select all checkbox
  document.getElementById('th-select-all')?.addEventListener('change', (e) => {
    const isChecked = e.target.checked;
    const filtered = getFilteredAndSortedTransactions();
    if (isChecked) {
      filtered.forEach(t => selectedTxnIds.add(t.id));
    } else {
      selectedTxnIds.clear();
    }
    updateBulkActionUI();
    renderTransactionsTable();
  });

  // Pagination buttons
  document.getElementById('btn-tx-prev')?.addEventListener('click', () => {
    if (currentPage > 1) {
      currentPage--;
      renderTransactionsTable();
    }
  });

  document.getElementById('btn-tx-next')?.addEventListener('click', () => {
    const maxPage = Math.ceil(getFilteredAndSortedTransactions().length / pageSize);
    if (currentPage < maxPage) {
      currentPage++;
      renderTransactionsTable();
    }
  });

  // CSV Export
  document.getElementById('btn-export-csv')?.addEventListener('click', exportFilteredTransactions);

  // Subscribe to state
  state.subscribe((event) => {
    if (event === 'transactions:updated') {
      renderTransactionsTable();
    }
  });

  renderTransactionsTable();
}

function getFilteredAndSortedTransactions() {
  let txns = [...state.transactions];

  const searchQuery = (document.getElementById('tx-search-input')?.value || '').toLowerCase().trim();
  const catFilter = document.getElementById('tx-category-filter')?.value || '';
  const typeFilter = document.getElementById('tx-type-filter')?.value || '';

  // Filter
  if (searchQuery) {
    txns = txns.filter(t =>
      (t.description || '').toLowerCase().includes(searchQuery) ||
      (t.merchant || '').toLowerCase().includes(searchQuery)
    );
  }

  if (catFilter) {
    txns = txns.filter(t => (t.category_name || '').toLowerCase() === catFilter.toLowerCase());
  }

  if (typeFilter) {
    if (typeFilter === 'income') txns = txns.filter(t => Number(t.amount) > 0 && t.category_name !== 'Transfers');
    if (typeFilter === 'expense') txns = txns.filter(t => Number(t.amount) < 0 && t.category_name !== 'Transfers');
    if (typeFilter === 'transfer') txns = txns.filter(t => (t.category_name || '').toLowerCase() === 'transfers');
  }

  // Sort
  txns.sort((a, b) => {
    let vA = a[sortField];
    let vB = b[sortField];

    if (sortField === 'amount') {
      vA = Number(vA) || 0;
      vB = Number(vB) || 0;
    } else if (sortField === 'txn_date') {
      vA = new Date(vA).getTime();
      vB = new Date(vB).getTime();
    }

    if (vA < vB) return sortAsc ? -1 : 1;
    if (vA > vB) return sortAsc ? 1 : -1;
    return 0;
  });

  return txns;
}

export function renderTransactionsTable() {
  const tbody = document.getElementById('transactions-table-body');
  if (!tbody) return;

  const allFiltered = getFilteredAndSortedTransactions();
  const totalCount = allFiltered.length;
  const maxPage = Math.max(1, Math.ceil(totalCount / pageSize));

  if (currentPage > maxPage) currentPage = maxPage;

  const startIndex = (currentPage - 1) * pageSize;
  const pageTxns = allFiltered.slice(startIndex, startIndex + pageSize);

  // Update pagination info
  const pageInfo = document.getElementById('tx-pagination-info');
  if (pageInfo) {
    const end = Math.min(startIndex + pageSize, totalCount);
    pageInfo.textContent = totalCount > 0
      ? `Showing ${startIndex + 1}-${end} of ${totalCount} transactions`
      : 'No transactions found matching filters';
  }

  const prevBtn = document.getElementById('btn-tx-prev');
  const nextBtn = document.getElementById('btn-tx-next');
  if (prevBtn) prevBtn.disabled = currentPage <= 1;
  if (nextBtn) nextBtn.disabled = currentPage >= maxPage;

  if (pageTxns.length === 0) {
    if (state.transactions.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align: center; padding: 48px 20px;">
            <div style="max-width: 440px; margin: 0 auto; display: flex; flex-direction: column; align-items: center; gap: 12px;">
              <div style="width: 48px; height: 48px; border-radius: 50%; background-color: rgba(14, 165, 233, 0.1); display: flex; align-items: center; justify-content: center; color: var(--accent-primary);">
                <i data-lucide="receipt" style="width: 24px; height: 24px;"></i>
              </div>
              <h4 style="font-size: var(--text-base); font-weight: 600; margin: 0;">No Transactions Yet</h4>
              <p style="font-size: var(--text-xs); color: var(--text-secondary); margin: 0;">
                Your transaction ledger is fresh and ready. Record your first income or expense to start seeing your financial reports.
              </p>
              <div style="display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap; justify-content: center;">
                <button type="button" id="btn-empty-add-tx" class="btn btn-primary btn-sm">
                  <i data-lucide="plus-circle"></i> Add Transaction
                </button>
                <a href="#import" class="btn btn-secondary btn-sm">
                  <i data-lucide="upload"></i> Import CSV
                </a>
              </div>
            </div>
          </td>
        </tr>
      `;
      document.getElementById('btn-empty-add-tx')?.addEventListener('click', () => {
        document.getElementById('btn-add-transaction')?.click();
      });
      renderIcons();
    } else {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align: center; padding: 40px; color: var(--text-muted);">
            No transactions match your current search or category filters.
          </td>
        </tr>
      `;
    }
    return;
  }

  const catOptions = DEFAULT_CATEGORIES.map(c => `<option value="${c.name}">${c.name}</option>`).join('');

  tbody.innerHTML = pageTxns.map(t => {
    const isSelected = selectedTxnIds.has(t.id);
    const amt = Number(t.amount);
    const isCredit = amt > 0;
    const isTransfer = (t.category_name || '').toLowerCase() === 'transfers';

    let amtClass = isCredit ? 'color: var(--accent-income);' : 'color: var(--text-primary);';
    if (isTransfer) amtClass = 'color: var(--text-muted);';

    return `
      <tr id="txn-row-${t.id}" data-id="${t.id}" class="${isSelected ? 'selected' : ''}">
        <td>
          <input type="checkbox" class="tx-row-checkbox" data-id="${t.id}" ${isSelected ? 'checked' : ''} aria-label="Select transaction">
        </td>
        <td style="font-family: var(--font-mono); font-size: 12px; white-space: nowrap;">
          ${t.txn_date}
        </td>
        <td>
          <div style="font-weight: 600; color: var(--text-primary);">${t.merchant || 'Unknown Merchant'}</div>
          <div style="font-size: 11px; color: var(--text-muted);">${t.description}</div>
        </td>
        <td>
          <select class="select tx-category-select" data-id="${t.id}" data-merchant="${t.merchant || ''}" style="padding: 4px 8px; font-size: 12px; height: 32px; border-radius: var(--radius-sm);">
            ${catOptions}
          </select>
        </td>
        <td style="text-align: right; font-weight: 700; ${amtClass}">
          ${isCredit ? '+' : ''}${formatINR(amt)}
        </td>
        <td style="text-align: center;">
          ${t.has_flag ? `<span class="badge badge-review" title="Flagged for review"><i data-lucide="flag" style="width: 10px;"></i> Review</span>` : '—'}
        </td>
        <td style="text-align: center;">
          <button class="btn btn-ghost btn-sm btn-icon btn-delete-row" data-id="${t.id}" data-merchant="${t.merchant || ''}" data-amount="${amt}" title="Delete transaction" aria-label="Delete transaction" style="color: var(--accent-expense); width: 28px; height: 28px; margin: 0 auto;">
            <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
          </button>
        </td>
      </tr>
    `;
  }).join('');

  // Re-create icons in table
  renderIcons(tbody);

  // Attach delete button handlers
  tbody.querySelectorAll('.btn-delete-row').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-id');
      const merchant = btn.getAttribute('data-merchant') || 'this transaction';
      const amt = Number(btn.getAttribute('data-amount') || 0);

      pendingDeleteTxnId = id;
      pendingBulkDelete = false;

      const msg = document.getElementById('delete-confirm-message');
      if (msg) {
        msg.textContent = `Are you sure you want to delete the transaction for "${merchant}" (${formatINR(amt)})?`;
      }
      document.getElementById('modal-delete-confirm')?.classList.add('open');
    });
  });

  // Set category dropdown values
  pageTxns.forEach(t => {
    const select = tbody.querySelector(`.tx-category-select[data-id="${t.id}"]`);
    if (select) {
      select.value = t.category_name || 'Uncategorised';
    }
  });

  // Attach inline edit handlers
  tbody.querySelectorAll('.tx-category-select').forEach(select => {
    select.addEventListener('change', async (e) => {
      const txnId = select.getAttribute('data-id');
      const merchant = select.getAttribute('data-merchant');
      const newCategory = select.value;

      const result = await api.updateTransactionCategory(txnId, newCategory, false);

      // Offer to apply to all transactions of this merchant
      if (merchant && merchant !== 'Unknown') {
        showToast(`Category updated to "${newCategory}". Apply to all "${merchant}" transactions?`, {
          actionText: 'Apply to All',
          duration: 6000,
          onAction: async () => {
            const updateRes = await api.updateTransactionCategory(txnId, newCategory, true, merchant);
            showToast(`Updated ${updateRes.affectedCount} transactions for ${merchant} to ${newCategory}.`);
            renderTransactionsTable();
          }
        });
      } else {
        showToast(`Category updated to "${newCategory}".`);
      }
    });
  });

  // Attach row checkbox selection handlers
  tbody.querySelectorAll('.tx-row-checkbox').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const id = cb.getAttribute('data-id');
      if (cb.checked) {
        selectedTxnIds.add(id);
      } else {
        selectedTxnIds.delete(id);
      }
      updateBulkActionUI();
    });
  });
}

function updateBulkActionUI() {
  const bulkBtn = document.getElementById('btn-bulk-recat');
  const bulkDeleteBtn = document.getElementById('btn-bulk-delete');
  const countSpan = document.getElementById('bulk-count');
  const deleteCountSpan = document.getElementById('bulk-delete-count');

  if (countSpan) countSpan.textContent = selectedTxnIds.size;
  if (deleteCountSpan) deleteCountSpan.textContent = selectedTxnIds.size;

  if (bulkBtn) bulkBtn.style.display = selectedTxnIds.size > 0 ? 'inline-flex' : 'none';
  if (bulkDeleteBtn) bulkDeleteBtn.style.display = selectedTxnIds.size > 0 ? 'inline-flex' : 'none';
}

function closeDeleteModal() {
  document.getElementById('modal-delete-confirm')?.classList.remove('open');
  pendingDeleteTxnId = null;
  pendingBulkDelete = false;
}

/**
 * Scroll to and highlight a cited transaction when clicked from Copilot
 */
export function highlightTransaction(txnId) {
  // Find transaction index in list
  const allFiltered = getFilteredAndSortedTransactions();
  const index = allFiltered.findIndex(t => t.id === txnId);

  if (index !== -1) {
    currentPage = Math.floor(index / pageSize) + 1;
    renderTransactionsTable();
  }

  // Switch view to transactions
  window.location.hash = '#transactions';

  setTimeout(() => {
    const row = document.getElementById(`txn-row-${txnId}`);
    if (row) {
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      row.classList.add('highlighted-txn');
      setTimeout(() => row.classList.remove('highlighted-txn'), 3000);
    }
  }, 150);
}

function exportFilteredTransactions() {
  const txns = getFilteredAndSortedTransactions();
  if (txns.length === 0) {
    alert('No transactions to export.');
    return;
  }

  const csvRows = [
    ['Date', 'Description', 'Merchant', 'Amount', 'Category', 'Source']
  ];

  txns.forEach(t => {
    csvRows.push([
      t.txn_date,
      `"${(t.description || '').replace(/"/g, '""')}"`,
      `"${(t.merchant || '').replace(/"/g, '""')}"`,
      t.amount,
      t.category_name,
      t.category_source || 'auto'
    ]);
  });

  const csvContent = 'data:text/csv;charset=utf-8,' + csvRows.map(e => e.join(',')).join('\n');
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', `FinPilot_Transactions_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
