// public/js/scenarios.js
// Interactive what-if cashflow and savings scenario simulator with full mathematical transparency

import { state } from './state.js';
import { runScenario, summarise } from '../../shared/engine.js';
import { formatINR } from './ui.js';
import { renderIcons } from './icons.js';

let projectionChart = null;
let selectedGoalId = null;

export function initScenarios() {
  // Slider listeners
  const sliders = [
    'slider-cut-dining',
    'slider-cut-shopping',
    'slider-extra-income',
    'slider-one-off'
  ];

  sliders.forEach(id => {
    document.getElementById(id)?.addEventListener('input', runSimulation);
  });

  // Goal Selector listener
  document.getElementById('scenario-goal-select')?.addEventListener('change', (e) => {
    selectedGoalId = e.target.value;
    runSimulation();
  });

  // Reset button
  document.getElementById('btn-reset-scenario')?.addEventListener('click', () => {
    sliders.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = 0;
    });
    runSimulation();
  });

  // Calculation accordion toggle
  document.getElementById('btn-toggle-scenario-calc')?.addEventListener('click', () => {
    const body = document.getElementById('scenario-calc-body');
    const chevron = document.getElementById('scenario-calc-chevron');
    if (body) {
      const isOpen = body.style.display !== 'none';
      body.style.display = isOpen ? 'none' : 'flex';
      if (chevron) {
        chevron.setAttribute('data-lucide', isOpen ? 'chevron-down' : 'chevron-up');
        renderIcons();
      }
    }
  });

  state.subscribe((event, payload) => {
    if (event === 'scenario:goal_selected') {
      selectedGoalId = payload;
      runSimulation();
    } else if (event === 'transactions:updated' || event === 'goals:updated') {
      runSimulation();
    }
  });

  runSimulation();
}

export function selectGoal(goalId) {
  selectedGoalId = goalId;
  runSimulation();
}

export function getSelectedGoalId() {
  return selectedGoalId;
}

export function runSimulation() {
  const sum = summarise(state.transactions);
  const monthCount = Math.max(1, sum.monthly.length);

  // Baseline monthly averages from historical data
  const monthlyIncome = sum.income / monthCount;
  const monthlyExpenses = sum.spending / monthCount;

  // Determine active target goal from state.goals
  const goalSelect = document.getElementById('scenario-goal-select');
  const activeGoalNameEl = document.getElementById('scenario-active-goal-name');

  let targetGoal = null;

  if (state.goals && state.goals.length > 0) {
    if (!selectedGoalId || !state.goals.some(g => (g.id || g.name) === selectedGoalId)) {
      selectedGoalId = state.goals[0].id || state.goals[0].name;
    }
    targetGoal = state.goals.find(g => (g.id || g.name) === selectedGoalId) || state.goals[0];

    if (goalSelect) {
      goalSelect.innerHTML = state.goals.map(g => {
        const id = g.id || g.name;
        const isSel = id === selectedGoalId ? 'selected' : '';
        return `<option value="${id}" ${isSel}>${g.name} (${formatINR(g.target_amount)})</option>`;
      }).join('');
    }
  } else {
    // Default fallback goal if user has no goals yet
    targetGoal = {
      name: 'Emergency Fund',
      target_amount: 300000,
      current_amount: 110000
    };
    if (goalSelect) {
      goalSelect.innerHTML = `<option value="default">Emergency Fund (₹3,00,000)</option>`;
    }
  }

  if (activeGoalNameEl) {
    activeGoalNameEl.textContent = targetGoal.name;
  }

  // Find dining and shopping averages
  const diningCat = sum.categories.find(c => c.name === 'Dining');
  const shoppingCat = sum.categories.find(c => c.name === 'Shopping');

  const avgDining = (diningCat ? diningCat.total : 0) / monthCount;
  const avgShopping = (shoppingCat ? shoppingCat.total : 0) / monthCount;

  // Read slider inputs
  const diningCutPct = Number(document.getElementById('slider-cut-dining')?.value || 0);
  const shoppingCutPct = Number(document.getElementById('slider-cut-shopping')?.value || 0);
  const extraIncome = Number(document.getElementById('slider-extra-income')?.value || 0);
  const oneOffExpense = Number(document.getElementById('slider-one-off')?.value || 0);

  // Calculate cut amounts in currency
  const diningCutAmt = Math.round(avgDining * (diningCutPct / 100));
  const shoppingCutAmt = Math.round(avgShopping * (shoppingCutPct / 100));

  // Update slider labels
  const labelDining = document.getElementById('label-cut-dining');
  const labelShopping = document.getElementById('label-cut-shopping');
  const labelExtra = document.getElementById('label-extra-income');
  const labelOneOff = document.getElementById('label-one-off');

  if (labelDining) labelDining.textContent = `${diningCutPct}% (${formatINR(diningCutAmt)}/mo)`;
  if (labelShopping) labelShopping.textContent = `${shoppingCutPct}% (${formatINR(shoppingCutAmt)}/mo)`;
  if (labelExtra) labelExtra.textContent = `+${formatINR(extraIncome)}/mo`;
  if (labelOneOff) labelOneOff.textContent = formatINR(oneOffExpense);

  // Execute scenario in engine.js for the selected goal
  const scenarioResult = runScenario({
    goal: targetGoal.target_amount,
    currentSavings: targetGoal.current_amount,
    monthlyIncome,
    monthlyExpenses,
    cutByCategory: {
      Dining: diningCutAmt,
      Shopping: shoppingCutAmt
    },
    extraMonthlyIncome: extraIncome,
    oneOffExpense: oneOffExpense
  });

  // Update KPI outputs
  const newSavingsEl = document.getElementById('scenario-monthly-savings');
  const monthsEl = document.getElementById('scenario-months-to-goal');
  const projectedDateEl = document.getElementById('scenario-projected-date');

  if (newSavingsEl) newSavingsEl.textContent = formatINR(scenarioResult.newMonthlySavings) + '/mo';
  if (monthsEl) {
    monthsEl.textContent = scenarioResult.attainable && scenarioResult.monthsToGoal !== null
      ? `${scenarioResult.monthsToGoal} months`
      : 'Unattainable';
  }
  if (projectedDateEl) {
    projectedDateEl.textContent = scenarioResult.projectedDate || 'Timeline exceeds 30 yrs';
  }

  // Update Multi-Goal Portfolio Banner when more than 1 goal exists
  const portfolioBanner = document.getElementById('multi-goal-portfolio-banner');
  if (portfolioBanner) {
    if (state.goals && state.goals.length > 1) {
      portfolioBanner.style.display = 'block';

      const totalTarget = state.goals.reduce((acc, g) => acc + (Number(g.target_amount) || 0), 0);
      const totalCurrent = state.goals.reduce((acc, g) => acc + (Number(g.current_amount) || 0), 0);
      const remainingDeficit = Math.max(0, totalTarget - totalCurrent);

      const countEl = document.getElementById('multi-goal-count-text');
      const deficitEl = document.getElementById('multi-goal-total-deficit');
      const totalMonthsEl = document.getElementById('multi-goal-total-months');

      if (countEl) countEl.textContent = `${state.goals.length} Active Goals`;
      if (deficitEl) deficitEl.textContent = formatINR(remainingDeficit);

      if (totalMonthsEl) {
        if (scenarioResult.newMonthlySavings > 0) {
          const portfolioMonths = Math.ceil(remainingDeficit / scenarioResult.newMonthlySavings);
          totalMonthsEl.textContent = `${portfolioMonths} months (~${(portfolioMonths / 12).toFixed(1)} yrs)`;
        } else {
          totalMonthsEl.textContent = 'Unattainable (Surplus <= 0)';
        }
      }
    } else {
      portfolioBanner.style.display = 'none';
    }
  }

  // Update Assumptions list in accordion
  const assumptionsList = document.getElementById('scenario-assumptions-list');
  if (assumptionsList) {
    assumptionsList.innerHTML = scenarioResult.assumptions.map(a => `<li>${a}</li>`).join('');
  }

  // Render Projection Chart
  renderProjectionChart(scenarioResult, targetGoal.target_amount);

  // Notify reactive state so Goals list updates its active card with the simulation result
  state.notify('scenario:simulated', {
    goalId: selectedGoalId,
    targetGoal,
    scenarioResult
  });

  renderIcons();
}

function renderProjectionChart(scenario, goalTarget) {
  const canvas = document.getElementById('chart-scenario-projection');
  if (!canvas) return;

  const labels = scenario.projections.map(p => `Mo ${p.month}`);
  const balanceData = scenario.projections.map(p => p.balance);
  const targetData = new Array(labels.length).fill(goalTarget);

  if (typeof window !== 'undefined' && window.Chart) {
    try {
      const existing = window.Chart?.getChart ? window.Chart.getChart(canvas) : null;
      if (existing) existing.destroy();
      if (projectionChart) {
        projectionChart.destroy();
        projectionChart = null;
      }
      projectionChart = new Chart(canvas, {
        type: 'line',
        data: {
          labels,
          datasets: [
            {
              label: 'Simulated Savings Balance',
              data: balanceData,
              borderColor: '#10B981',
              backgroundColor: 'rgba(16, 185, 129, 0.1)',
              fill: true,
              tension: 0.3,
              pointRadius: 2
            },
            {
              label: 'Target Goal Level',
              data: targetData,
              borderColor: '#F59E0B',
              borderDash: [6, 4],
              fill: false,
              pointRadius: 0
            }
          ]
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
      console.warn('[Scenarios] Chart.js failed, using Canvas fallback:', e);
    }
  }

  // Fallback: Canvas 2D line & target level renderer
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const w = canvas.parentElement.clientWidth || 600;
  const h = canvas.parentElement.clientHeight || 220;
  canvas.width = w * 2;
  canvas.height = h * 2;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  ctx.scale(2, 2);

  ctx.clearRect(0, 0, w, h);

  const maxVal = Math.max(...balanceData, goalTarget, 1);
  const chartHeight = h - 40;
  const padLeft = 40;
  const stepX = (w - padLeft - 20) / (labels.length - 1 || 1);

  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';

  // Target Goal Dashed Line
  const targetY = chartHeight - (goalTarget / maxVal) * (chartHeight - 30);
  ctx.strokeStyle = '#F59E0B';
  ctx.setLineDash([5, 5]);
  ctx.beginPath();
  ctx.moveTo(padLeft, targetY);
  ctx.lineTo(w - 10, targetY);
  ctx.stroke();
  ctx.setLineDash([]);

  // Balance Line
  ctx.strokeStyle = '#10B981';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < balanceData.length; i++) {
    const x = padLeft + i * stepX;
    const y = chartHeight - (balanceData[i] / maxVal) * (chartHeight - 30);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Axis
  ctx.strokeStyle = isDark ? '#334155' : '#e2e8f0';
  ctx.beginPath();
  ctx.moveTo(padLeft, chartHeight);
  ctx.lineTo(w - 10, chartHeight);
  ctx.stroke();
}
