// public/js/dashboard.js
// Renders the Dashboard view with KPI cards, Chart.js graphs (or Canvas 2D fallback), and top outlets

import { state } from './state.js';
import { api } from './api.js';
import { summarise } from '../../shared/engine.js';
import { formatINR, animateCountUp, showCalculationModal } from './ui.js';
import { renderIcons } from './icons.js';
import { updateOnboardingUI } from './setup_wizard.js';

let chartCategories = null;
let chartMonthly = null;
let chartCumulative = null;

export function initDashboard() {
  state.subscribe((event) => {
    if (event === 'transactions:updated' || event === 'period:changed') {
      renderDashboard();
    }
  });

  // Attach KPI info button modals
  document.querySelectorAll('.kpi-info-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const calcType = btn.getAttribute('data-calc');
      openKpiExplanation(calcType);
    });
  });

  // Empty state banner button actions
  document.getElementById('btn-dashboard-voice-tx')?.addEventListener('click', () => {
    document.getElementById('btn-header-voice-tx')?.click();
  });

  renderDashboard();
}

/**
 * Filter transactions based on activePeriod selector
 */
function getFilteredTransactions() {
  const txns = state.transactions;
  if (!txns || txns.length === 0) return [];
  if (state.activePeriod === 'all') return txns;

  // Find max date in dataset as anchor
  const dates = txns.map(t => new Date(t.txn_date)).filter(d => !isNaN(d));
  if (dates.length === 0) return txns;
  const maxDate = new Date(Math.max(...dates));

  const year = maxDate.getFullYear();
  const month = maxDate.getMonth(); // 0-based

  if (state.activePeriod === 'this_month') {
    const start = new Date(year, month, 1);
    return txns.filter(t => new Date(t.txn_date) >= start);
  }

  if (state.activePeriod === 'last_month') {
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0, 23, 59, 59);
    return txns.filter(t => {
      const d = new Date(t.txn_date);
      return d >= start && d <= end;
    });
  }

  if (state.activePeriod === 'last_3_months') {
    const start = new Date(year, month - 2, 1);
    return txns.filter(t => new Date(t.txn_date) >= start);
  }

  return txns;
}

export function renderDashboard() {
  const filtered = getFilteredTransactions();
  const summary = summarise(filtered);

  // Refresh Onboarding Card and user entries
  updateOnboardingUI();

  // Ensure Sample Data Badge is never shown
  const sampleBadge = document.getElementById('sample-data-badge');
  if (sampleBadge) {
    sampleBadge.style.display = 'none';
  }

  // 1. Update KPI Values
  const incomeEl = document.getElementById('kpi-income');
  const spendingEl = document.getElementById('kpi-spending');
  const netEl = document.getElementById('kpi-net');
  const savingsRateEl = document.getElementById('kpi-savings-rate');

  animateCountUp(incomeEl, summary.income);
  animateCountUp(spendingEl, summary.spending);
  animateCountUp(netEl, summary.net);
  animateCountUp(savingsRateEl, summary.savingsRate, '', true);

  // Style net card green if surplus, red if deficit
  if (netEl) {
    netEl.style.color = summary.net >= 0 ? 'var(--accent-teal)' : 'var(--accent-expense)';
  }

  // 2. Render Charts
  renderCategoryChart(summary.categories);
  renderMonthlyChart(summary.monthly);
  renderCumulativeChart(summary.monthly);

  // 3. Render Top Merchants
  renderTopMerchants(summary.topMerchants);
}

function renderCategoryChart(categories = []) {
  const canvas = document.getElementById('chart-categories');
  if (!canvas) return;

  const labels = categories.slice(0, 6).map(c => c.name);
  const data = categories.slice(0, 6).map(c => c.total);
  const colors = ['#3B82F6', '#EC4899', '#8B5CF6', '#F59E0B', '#10B981', '#14B8A6'];

  if (typeof window !== 'undefined' && window.Chart) {
    try {
      const existing = window.Chart.getChart ? window.Chart.getChart(canvas) : null;
      if (existing) existing.destroy();
      if (chartCategories) {
        chartCategories.destroy();
        chartCategories = null;
      }
      chartCategories = new Chart(canvas, {
        type: 'doughnut',
        data: {
          labels,
          datasets: [{
            data,
            backgroundColor: colors.slice(0, labels.length),
            borderWidth: 2,
            borderColor: document.documentElement.getAttribute('data-theme') === 'dark' ? '#111827' : '#ffffff'
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: 'right', labels: { boxWidth: 12, font: { size: 11 } } },
            tooltip: { callbacks: { label: (ctx) => ` ${ctx.label}: ${formatINR(ctx.raw)}` } }
          },
          cutout: '65%'
        }
      });
      return;
    } catch (e) {
      console.warn('[Dashboard] Chart.js failed, using Canvas fallback:', e);
    }
  }

  // Fallback: Pure HTML5 Canvas Doughnut Drawing
  drawFallbackDoughnut(canvas, labels, data, colors);
}

function renderMonthlyChart(monthly = []) {
  const canvas = document.getElementById('chart-monthly');
  if (!canvas) return;

  const labels = monthly.map(m => m.month);
  const incomeData = monthly.map(m => m.income);
  const spendingData = monthly.map(m => m.spending);

  if (typeof window !== 'undefined' && window.Chart) {
    try {
      const existing = window.Chart.getChart ? window.Chart.getChart(canvas) : null;
      if (existing) existing.destroy();
      if (chartMonthly) {
        chartMonthly.destroy();
        chartMonthly = null;
      }
      chartMonthly = new Chart(canvas, {
        type: 'bar',
        data: {
          labels,
          datasets: [
            { label: 'Inflow', data: incomeData, backgroundColor: '#10B981', borderRadius: 4 },
            { label: 'Outflow', data: spendingData, backgroundColor: '#EF4444', borderRadius: 4 }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            y: { beginAtZero: true, ticks: { callback: (val) => '₹' + (val >= 1000 ? (val / 1000) + 'k' : val) } }
          }
        }
      });
      return;
    } catch (e) {
      console.warn('[Dashboard] Chart.js failed, using Canvas fallback:', e);
    }
  }

  drawFallbackBar(canvas, labels, incomeData, spendingData);
}

function renderCumulativeChart(monthly = []) {
  const canvas = document.getElementById('chart-cumulative');
  if (!canvas) return;

  const labels = monthly.map(m => m.month);
  let cumulative = 0;
  const cumulativeData = monthly.map(m => {
    cumulative += m.net;
    return cumulative;
  });

  if (typeof window !== 'undefined' && window.Chart) {
    try {
      const existing = window.Chart.getChart ? window.Chart.getChart(canvas) : null;
      if (existing) existing.destroy();
      if (chartCumulative) {
        chartCumulative.destroy();
        chartCumulative = null;
      }
      chartCumulative = new Chart(canvas, {
        type: 'line',
        data: {
          labels,
          datasets: [{
            label: 'Cumulative Net Savings',
            data: cumulativeData,
            borderColor: '#0EA5E9',
            backgroundColor: 'rgba(14, 165, 233, 0.1)',
            fill: true,
            tension: 0.35,
            pointRadius: 4,
            pointBackgroundColor: '#0EA5E9'
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            y: { ticks: { callback: (val) => '₹' + (val >= 1000 ? (val / 1000) + 'k' : val) } }
          }
        }
      });
      return;
    } catch (e) {
      console.warn('[Dashboard] Chart.js failed, using Canvas fallback:', e);
    }
  }

  drawFallbackLine(canvas, labels, cumulativeData);
}

// -------------------------------------------------------------
// PURE HTML5 CANVAS FALLBACK RENDERERS (Zero external dependency)
// -------------------------------------------------------------

function drawFallbackDoughnut(canvas, labels, data, colors) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const w = canvas.parentElement.clientWidth || 300;
  const h = canvas.parentElement.clientHeight || 260;
  canvas.width = w * 2;
  canvas.height = h * 2;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  ctx.scale(2, 2);

  ctx.clearRect(0, 0, w, h);

  const total = data.reduce((a, b) => a + b, 0);
  if (total === 0) {
    ctx.fillStyle = '#94a3b8';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No expense data to display', w / 2, h / 2);
    return;
  }

  const cx = w * 0.35;
  const cy = h / 2;
  const r = Math.min(cx, cy) - 16;
  const innerR = r * 0.65;

  let currentAngle = -Math.PI / 2;

  for (let i = 0; i < data.length; i++) {
    const sliceAngle = (data[i] / total) * 2 * Math.PI;
    ctx.beginPath();
    ctx.arc(cx, cy, r, currentAngle, currentAngle + sliceAngle);
    ctx.arc(cx, cy, innerR, currentAngle + sliceAngle, currentAngle, true);
    ctx.closePath();
    ctx.fillStyle = colors[i % colors.length];
    ctx.fill();
    currentAngle += sliceAngle;
  }

  // Draw legend on the right
  ctx.textAlign = 'left';
  ctx.font = '11px sans-serif';
  let ly = 30;
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';

  for (let i = 0; i < labels.length; i++) {
    const pct = Math.round((data[i] / total) * 100);
    ctx.fillStyle = colors[i % colors.length];
    ctx.fillRect(w * 0.68, ly, 10, 10);

    ctx.fillStyle = isDark ? '#f1f5f9' : '#1e293b';
    ctx.fillText(`${labels[i]} (${pct}%)`, w * 0.68 + 16, ly + 9);
    ly += 22;
  }
}

function drawFallbackBar(canvas, labels, incomeData, spendingData) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const w = canvas.parentElement.clientWidth || 600;
  const h = canvas.parentElement.clientHeight || 260;
  canvas.width = w * 2;
  canvas.height = h * 2;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  ctx.scale(2, 2);

  ctx.clearRect(0, 0, w, h);

  if (labels.length === 0) return;

  const maxVal = Math.max(...incomeData, ...spendingData, 1);
  const chartHeight = h - 50;
  const padLeft = 40;
  const groupWidth = (w - padLeft - 20) / labels.length;
  const barWidth = Math.min(24, groupWidth * 0.35);

  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';

  // Grid line
  ctx.strokeStyle = isDark ? '#334155' : '#e2e8f0';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padLeft, chartHeight);
  ctx.lineTo(w - 10, chartHeight);
  ctx.stroke();

  for (let i = 0; i < labels.length; i++) {
    const gx = padLeft + i * groupWidth + (groupWidth - barWidth * 2 - 4) / 2;

    const inH = (incomeData[i] / maxVal) * (chartHeight - 30);
    const spH = (spendingData[i] / maxVal) * (chartHeight - 30);

    // Income Bar (Green)
    ctx.fillStyle = '#10B981';
    ctx.fillRect(gx, chartHeight - inH, barWidth, inH);

    // Spending Bar (Red)
    ctx.fillStyle = '#EF4444';
    ctx.fillRect(gx + barWidth + 4, chartHeight - spH, barWidth, spH);

    // Label
    ctx.fillStyle = isDark ? '#94a3b8' : '#64748b';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(labels[i].slice(5), gx + barWidth, chartHeight + 16);
  }
}

function drawFallbackLine(canvas, labels, data) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const w = canvas.parentElement.clientWidth || 600;
  const h = canvas.parentElement.clientHeight || 260;
  canvas.width = w * 2;
  canvas.height = h * 2;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  ctx.scale(2, 2);

  ctx.clearRect(0, 0, w, h);

  if (labels.length === 0) return;

  const minVal = Math.min(0, ...data);
  const maxVal = Math.max(...data, 1);
  const range = maxVal - minVal || 1;
  const chartHeight = h - 50;
  const padLeft = 40;
  const stepX = (w - padLeft - 20) / (labels.length - 1 || 1);

  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';

  // Draw axis
  ctx.strokeStyle = isDark ? '#334155' : '#e2e8f0';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padLeft, chartHeight);
  ctx.lineTo(w - 10, chartHeight);
  ctx.stroke();

  // Draw smooth line
  ctx.beginPath();
  ctx.strokeStyle = '#0EA5E9';
  ctx.lineWidth = 2.5;

  for (let i = 0; i < data.length; i++) {
    const x = padLeft + i * stepX;
    const y = chartHeight - ((data[i] - minVal) / range) * (chartHeight - 30);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Draw points & labels
  for (let i = 0; i < data.length; i++) {
    const x = padLeft + i * stepX;
    const y = chartHeight - ((data[i] - minVal) / range) * (chartHeight - 30);

    ctx.fillStyle = '#0EA5E9';
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = isDark ? '#94a3b8' : '#64748b';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(labels[i].slice(5), x, chartHeight + 16);
  }
}

function renderTopMerchants(topMerchants = []) {
  const container = document.getElementById('top-merchants-list');
  if (!container) return;

  if (topMerchants.length === 0) {
    container.innerHTML = `
      <div id="empty-top-merchants" style="display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; color: var(--text-muted); padding: 30px 16px;">
        <i data-lucide="store" style="width: 36px; height: 36px; opacity: 0.3; margin-bottom: 8px;"></i>
        <p style="font-size: var(--text-xs); margin: 0;">Top merchants will rank here once expenses are recorded.</p>
      </div>
    `;
    renderIcons();
    return;
  }

  container.innerHTML = topMerchants.slice(0, 6).map((m, idx) => `
    <div style="display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background-color: var(--bg-surface-elevated); border-radius: var(--radius-md); font-size: var(--text-xs);">
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="font-weight: 700; color: var(--text-muted); width: 14px;">#${idx + 1}</span>
        <span style="font-weight: 600; color: var(--text-primary);">${m.merchant}</span>
      </div>
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="color: var(--text-muted); font-size: 10px;">${m.count} txns</span>
        <strong style="color: var(--text-primary);">${formatINR(m.total)}</strong>
      </div>
    </div>
  `).join('');
}

function openKpiExplanation(type) {
  const filtered = getFilteredTransactions();
  const sum = summarise(filtered);

  switch (type) {
    case 'income':
      showCalculationModal('Total Inflow (Income)', {
        formula: 'Total Inflow = Sum of all positive amounts (excluding Transfers)',
        inputs: { totalCents: sum.calculation.incomeCents, totalDecimal: sum.income },
        explanation: 'All credits deposited to the account including monthly payroll salary, refunds, and interest. Excludes self-account transfers.',
        transactionsUsed: sum.transactionCount
      });
      break;

    case 'spending':
      showCalculationModal('Total Spending (Outflow)', {
        formula: 'Total Spending = Sum of absolute values of all negative amounts (excluding Transfers)',
        inputs: { totalCents: sum.calculation.spendingCents, totalDecimal: sum.spending },
        explanation: 'All merchant purchases, bills, dining, rent and subscription outflows. Calculated strictly using integer cents without float drift.',
        transactionsUsed: sum.transactionCount
      });
      break;

    case 'net':
      showCalculationModal('Net Cash Flow Surplus', {
        formula: 'Net = Total Inflow - Total Spending',
        inputs: { income: sum.income, spending: sum.spending, net: sum.net },
        explanation: 'The remaining disposable cash surplus after covering all monthly living expenses and subscriptions.',
        transactionsUsed: sum.transactionCount
      });
      break;

    case 'savingsRate':
      showCalculationModal('Savings Rate Percentage', {
        formula: 'Savings Rate = (Net Cash Flow / Total Inflow) * 100',
        inputs: { net: sum.net, income: sum.income, ratePercent: sum.savingsRate },
        explanation: 'Measures what percentage of your total income was successfully retained as savings.',
        transactionsUsed: sum.transactionCount
      });
      break;
  }
}
