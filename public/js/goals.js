// public/js/goals.js
// Savings goals management with real-time What-If scenario synchronization

import { state } from './state.js';
import { api } from './api.js';
import { formatINR, showToast } from './ui.js';
import { renderIcons } from './icons.js';

let activeSimulatedGoalId = null;
let latestScenarioResult = null;

export function initGoals() {
  state.subscribe((event, payload) => {
    if (event === 'goals:updated') {
      renderGoals();
    } else if (event === 'scenario:simulated') {
      activeSimulatedGoalId = payload.goalId;
      latestScenarioResult = payload.scenarioResult;
      renderGoals();
    } else if (event === 'scenario:goal_selected') {
      activeSimulatedGoalId = payload;
      renderGoals();
    }
  });

  // Modal open & close
  document.getElementById('btn-create-goal')?.addEventListener('click', () => {
    const modal = document.getElementById('modal-create-goal');
    if (modal) {
      modal.classList.add('open');
      const dateInput = document.getElementById('goal-input-date');
      if (dateInput) {
        // Default target date to 6 months from today
        const target = new Date();
        target.setMonth(target.getMonth() + 6);
        dateInput.value = target.toISOString().slice(0, 10);
      }
    }
  });

  // Form submission
  document.getElementById('form-create-goal')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('goal-input-name').value.trim();
    const target = Number(document.getElementById('goal-input-target').value);
    const current = Number(document.getElementById('goal-input-current').value || 0);
    const targetDate = document.getElementById('goal-input-date').value;

    const newGoal = {
      name,
      target_amount: target,
      current_amount: current,
      target_date: targetDate
    };

    await api.addGoal(newGoal);

    document.getElementById('modal-create-goal')?.classList.remove('open');
    e.target.reset();
    showToast(`Created savings goal: "${name}"!`);
  });

  renderGoals();
}

export function renderGoals() {
  const container = document.getElementById('goals-list-container');
  if (!container) return;

  const goals = state.goals;

  if (goals.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 28px; color: var(--text-muted); font-size: var(--text-xs);">
        No active savings goals. Click "New Goal" to establish your first milestone!
      </div>
    `;
    return;
  }

  // Determine which goal is actively simulated
  if (!activeSimulatedGoalId || !goals.some(g => (g.id || g.name) === activeSimulatedGoalId)) {
    activeSimulatedGoalId = goals[0].id || goals[0].name;
  }

  container.innerHTML = goals.map(g => {
    const goalId = g.id || g.name;
    const isSimulating = goalId === activeSimulatedGoalId;
    const target = Number(g.target_amount) || 0;
    const current = Number(g.current_amount) || 0;
    const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;

    let simHtml = '';
    if (isSimulating && latestScenarioResult) {
      const pDate = latestScenarioResult.projectedDate || (latestScenarioResult.attainable && latestScenarioResult.monthsToGoal !== null ? `${latestScenarioResult.monthsToGoal} months` : 'Unattainable');
      const monthlySavings = latestScenarioResult.newMonthlySavings;

      simHtml = `
        <div style="margin-top: 12px; padding: 10px 12px; background: rgba(16, 185, 129, 0.08); border: 1px dashed rgba(16, 185, 129, 0.45); border-radius: var(--radius-sm); font-size: 11px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
            <span style="color: var(--text-secondary); display: flex; align-items: center; gap: 4px;">
              <i data-lucide="zap" style="width: 12px; height: 12px; color: var(--accent-primary);"></i>
              <strong>Simulated Projection:</strong>
            </span>
            <span style="color: var(--accent-income); font-weight: 700; font-size: 12px;">${pDate}</span>
          </div>
          <div style="display: flex; justify-content: space-between; color: var(--text-muted); font-size: 10px;">
            <span>Simulated Pace: <strong style="color: var(--text-primary);">${formatINR(monthlySavings)}/mo</strong></span>
            <span>Target: <strong style="color: var(--text-primary);">${g.target_date || 'Ongoing'}</strong></span>
          </div>
        </div>
      `;
    }

    const cardBorder = isSimulating
      ? 'border: 2px solid var(--accent-primary); box-shadow: 0 0 16px rgba(16, 185, 129, 0.18);'
      : 'border: 1px solid var(--border-subtle);';

    return `
      <div class="goal-item-card" data-goal-id="${goalId}" style="background-color: var(--bg-surface-elevated); ${cardBorder} border-radius: var(--radius-md); padding: 16px; cursor: pointer; transition: all 0.2s ease;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
          <div>
            <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
              <h4 style="font-size: var(--text-sm); font-weight: 700; color: var(--text-primary); margin: 0;">${g.name}</h4>
              ${isSimulating ? `<span style="font-size: 9px; font-weight: 700; background: rgba(16, 185, 129, 0.2); color: var(--accent-primary); border: 1px solid rgba(16, 185, 129, 0.4); padding: 1px 6px; border-radius: 999px; text-transform: uppercase;">⚡ Simulating</span>` : ''}
            </div>
            <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">Deadline: ${g.target_date || 'Ongoing'}</div>
          </div>
          <span style="font-size: var(--text-sm); font-weight: 700; color: var(--accent-primary);">${pct}%</span>
        </div>

        <!-- Progress bar -->
        <div style="height: 8px; background-color: var(--bg-subtle); border-radius: var(--radius-full); overflow: hidden; margin-bottom: 8px;">
          <div style="width: ${pct}%; height: 100%; background: linear-gradient(90deg, var(--accent-primary), var(--accent-teal)); border-radius: var(--radius-full);"></div>
        </div>

        <div style="display: flex; justify-content: space-between; font-size: 11px; color: var(--text-secondary);">
          <span>Saved: <strong>${formatINR(current)}</strong></span>
          <span>Goal: <strong>${formatINR(target)}</strong></span>
        </div>

        ${simHtml}

        ${!isSimulating ? `
          <div style="margin-top: 8px; font-size: 10px; color: var(--text-muted); text-align: right; display: flex; align-items: center; justify-content: flex-end; gap: 4px;">
            <i data-lucide="sliders" style="width: 10px; height: 10px;"></i>
            <span>Click to simulate in What-If</span>
          </div>
        ` : ''}
      </div>
    `;
  }).join('');

  // Attach click listener to each goal card to select it for What-If simulation
  container.querySelectorAll('.goal-item-card').forEach(card => {
    card.addEventListener('click', () => {
      const gid = card.getAttribute('data-goal-id');
      if (gid) {
        activeSimulatedGoalId = gid;
        state.notify('scenario:goal_selected', gid);
      }
    });
  });

  renderIcons();
}
