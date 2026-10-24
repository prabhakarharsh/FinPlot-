// public/js/goals.js
// Savings goals management

import { state } from './state.js';
import { api } from './api.js';
import { formatINR, showToast } from './ui.js';

export function initGoals() {
  state.subscribe((event) => {
    if (event === 'goals:updated') {
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

  container.innerHTML = goals.map(g => {
    const target = Number(g.target_amount) || 0;
    const current = Number(g.current_amount) || 0;
    const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;

    return `
      <div style="background-color: var(--bg-surface-elevated); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 16px;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
          <div>
            <h4 style="font-size: var(--text-sm); font-weight: 700; color: var(--text-primary);">${g.name}</h4>
            <div style="font-size: 11px; color: var(--text-muted);">Target: ${g.target_date || 'Ongoing'}</div>
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
      </div>
    `;
  }).join('');
}
