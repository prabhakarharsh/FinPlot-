// public/js/import.js
// CSV Import, column mapping, duplicate detection, and deterministic reconciliation audit

import { state } from './state.js';
import { api } from './api.js';
import { categorise, reconcile, formatCurrency } from '../../shared/engine.js';
import { formatINR, showToast } from './ui.js';
import { renderIcons } from './icons.js';

let rawParsedRows = [];
let detectedHeaders = [];

export function initImport() {
  const dropzone = document.getElementById('csv-dropzone');
  const fileInput = document.getElementById('csv-file-input');

  // Drag and drop events
  dropzone?.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });

  dropzone?.addEventListener('dragleave', () => {
    dropzone.classList.remove('dragover');
  });

  dropzone?.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) handleSelectedFile(file);
  });

  fileInput?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleSelectedFile(file);
  });

  // Cancel import button
  document.getElementById('btn-cancel-import')?.addEventListener('click', () => {
    document.getElementById('column-mapper-section').style.display = 'none';
    rawParsedRows = [];
  });

  // Confirm and process import button
  document.getElementById('btn-confirm-import')?.addEventListener('click', processAndSaveImport);
}

function handleSelectedFile(file) {
  if (!file.name.endsWith('.csv')) {
    alert('Please select a valid CSV file.');
    return;
  }

  Papa.parse(file, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: true,
    complete: (results) => {
      rawParsedRows = results.data;
      detectedHeaders = results.meta.fields || [];

      if (rawParsedRows.length === 0) {
        alert('The uploaded CSV file is empty.');
        return;
      }

      showColumnMapper();
    },
    error: (err) => {
      alert('Failed to parse CSV file: ' + err.message);
    }
  });
}

function showColumnMapper() {
  const mapperSection = document.getElementById('column-mapper-section');
  if (!mapperSection) return;

  mapperSection.style.display = 'block';

  const selectDate = document.getElementById('map-col-date');
  const selectDesc = document.getElementById('map-col-desc');
  const selectAmount = document.getElementById('map-col-amount');
  const selectCategory = document.getElementById('map-col-category');

  const optionsHtml = detectedHeaders.map(h => `<option value="${h}">${h}</option>`).join('');

  if (selectDate) selectDate.innerHTML = optionsHtml;
  if (selectDesc) selectDesc.innerHTML = optionsHtml;
  if (selectAmount) selectAmount.innerHTML = optionsHtml;
  if (selectCategory) selectCategory.innerHTML = '<option value="">None (Auto-Categorise)</option>' + optionsHtml;

  // Smart auto-selection of columns based on common bank header names
  detectedHeaders.forEach(h => {
    const l = h.toLowerCase();
    if (l.includes('date') || l.includes('time')) selectDate.value = h;
    if (l.includes('desc') || l.includes('particular') || l.includes('merchant') || l.includes('narration') || l.includes('detail')) selectDesc.value = h;
    if (l.includes('amount') || l.includes('amt') || l.includes('value')) selectAmount.value = h;
    if (l.includes('category') || l.includes('type')) selectCategory.value = h;
  });

  renderPreviewTable();

  // Listeners to re-render preview when mapping changes
  [selectDate, selectDesc, selectAmount, selectCategory].forEach(sel => {
    sel?.addEventListener('change', renderPreviewTable);
  });
}

function renderPreviewTable() {
  const head = document.getElementById('import-preview-head');
  const body = document.getElementById('import-preview-body');
  if (!head || !body) return;

  const dateCol = document.getElementById('map-col-date').value;
  const descCol = document.getElementById('map-col-desc').value;
  const amtCol = document.getElementById('map-col-amount').value;
  const catCol = document.getElementById('map-col-category').value;

  head.innerHTML = `
    <tr>
      <th>Date (${dateCol})</th>
      <th>Description (${descCol})</th>
      <th>Amount (${amtCol})</th>
      <th>Assigned Category</th>
    </tr>
  `;

  const previewRows = rawParsedRows.slice(0, 20);

  body.innerHTML = previewRows.map(row => {
    const rawAmt = Number(row[amtCol]);
    const desc = String(row[descCol] || '');
    let category = catCol && row[catCol] ? row[catCol] : null;

    if (!category) {
      const catRes = categorise({ description: desc }, state.categoryRules);
      category = catRes.category;
    }

    return `
      <tr>
        <td style="font-family: var(--font-mono); font-size: 11px;">${row[dateCol] || '—'}</td>
        <td style="font-weight: 500;">${desc || '—'}</td>
        <td style="font-weight: 600; color: ${rawAmt > 0 ? 'var(--accent-income)' : 'var(--text-primary)'};">
          ${formatINR(rawAmt)}
        </td>
        <td><span class="badge badge-neutral">${category}</span></td>
      </tr>
    `;
  }).join('');
}

async function processAndSaveImport() {
  const dateCol = document.getElementById('map-col-date').value;
  const descCol = document.getElementById('map-col-desc').value;
  const amtCol = document.getElementById('map-col-amount').value;
  const catCol = document.getElementById('map-col-category').value;

  const existingHashes = new Set(state.transactions.map(t => t.hash));
  const newTransactions = [];
  let skippedDuplicates = 0;

  for (let idx = 0; idx < rawParsedRows.length; idx++) {
    const row = rawParsedRows[idx];
    const dateVal = row[dateCol];
    const descVal = row[descCol] || 'Transaction';
    const amountVal = Number(row[amtCol]);

    if (!dateVal || isNaN(amountVal)) continue;

    const hash = `${dateVal}_${amountVal}_${descVal}`;

    // Deduplication
    if (existingHashes.has(hash)) {
      skippedDuplicates++;
      continue;
    }

    let category = catCol && row[catCol] ? row[catCol] : null;
    let source = 'user';

    if (!category) {
      const catRes = categorise({ description: descVal }, state.categoryRules);
      category = catRes.category;
      source = catRes.source;
    }

    newTransactions.push({
      id: `tx-import-${Date.now()}-${idx}`,
      txn_date: String(dateVal).slice(0, 10),
      description: descVal,
      merchant: descVal.split(/[*#/-]/)[0].trim(),
      amount: amountVal,
      category_name: category,
      category_source: source,
      hash,
      is_sample: false
    });

    existingHashes.add(hash);
  }

  // Combine with existing
  const allTxns = [...newTransactions, ...state.transactions];
  state.setTransactions(allTxns, false);
  localStorage.setItem('finpilot_txns', JSON.stringify(allTxns));

  // Run deterministic reconciliation
  const reconReport = reconcile(rawParsedRows.map(r => ({ amount: Number(r[amtCol]) })), newTransactions);
  displayReconciliationReport(reconReport);

  // Sync to server backend
  await api.syncDemoState();

  // Hide column mapper
  document.getElementById('column-mapper-section').style.display = 'none';

  showToast(`Successfully imported ${newTransactions.length} transactions (${skippedDuplicates} duplicates skipped).`);
}

function displayReconciliationReport(report) {
  const panel = document.getElementById('reconciliation-panel');
  if (!panel) return;

  panel.style.display = 'block';

  const rowsVal = document.getElementById('recon-rows-val');
  const inflowVal = document.getElementById('recon-inflow-val');
  const outflowVal = document.getElementById('recon-outflow-val');
  const msgEl = document.getElementById('recon-summary-msg');
  const titleEl = document.getElementById('recon-status-title');

  if (rowsVal) rowsVal.textContent = `${report.report.rows.dbCount} / ${report.report.rows.importCount} rows`;
  if (inflowVal) inflowVal.textContent = formatINR(report.report.inflow.dbInflow);
  if (outflowVal) outflowVal.textContent = formatINR(report.report.outflow.dbOutflow);
  if (msgEl) msgEl.textContent = report.message;

  if (report.pass) {
    panel.style.borderLeftColor = 'var(--accent-income)';
    if (titleEl) {
      titleEl.innerHTML = `<i data-lucide="check-circle-2" style="color: var(--accent-income);"></i> Reconciliation Audit: PASSED ✅`;
    }
  } else {
    panel.style.borderLeftColor = 'var(--accent-review)';
    if (titleEl) {
      titleEl.innerHTML = `<i data-lucide="alert-circle" style="color: var(--accent-review);"></i> Reconciliation Audit: DISCREPANCY DETECTED ⚠️`;
    }
  }

  renderIcons();
}
