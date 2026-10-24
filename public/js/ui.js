// public/js/ui.js
// UI utilities, theme toggle, toasts, modals, and formatters

export function initTheme() {
  const saved = localStorage.getItem('finpilot_theme') || 'light';
  document.documentElement.setAttribute('data-theme', saved);
  updateThemeIcon(saved);
}

export function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('finpilot_theme', next);
  updateThemeIcon(next);
}

function updateThemeIcon(theme) {
  const icon = document.getElementById('theme-icon');
  if (!icon) return;
  if (theme === 'dark') {
    icon.setAttribute('data-lucide', 'moon');
  } else {
    icon.setAttribute('data-lucide', 'sun');
  }
}

/**
 * Format currency with Indian Rupee symbol and en-IN lakhs/crores formatting
 */
export function formatINR(amount) {
  const num = typeof amount === 'number' ? amount : Number(amount) || 0;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
    minimumFractionDigits: 2
  }).format(num);
}

/**
 * Smooth animated count-up for numbers on KPI cards
 */
export function animateCountUp(element, endVal, prefix = '₹', isPercentage = false) {
  if (!element) return;
  const target = Number(endVal) || 0;
  const duration = 400; // ms
  const startTime = performance.now();

  function update(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    // Ease-out cubic
    const ease = 1 - Math.pow(1 - progress, 3);
    const current = target * ease;

    if (isPercentage) {
      element.textContent = `${current.toFixed(1)}%`;
    } else {
      element.textContent = formatINR(current);
    }

    if (progress < 1) {
      requestAnimationFrame(update);
    } else {
      if (isPercentage) {
        element.textContent = `${target.toFixed(1)}%`;
      } else {
        element.textContent = formatINR(target);
      }
    }
  }

  requestAnimationFrame(update);
}

/**
 * Display toast notification with optional action button (e.g. "Undo")
 */
export function showToast(message, options = {}) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast';

  const textSpan = document.createElement('span');
  textSpan.textContent = message;
  toast.appendChild(textSpan);

  if (options.actionText && typeof options.onAction === 'function') {
    const actionBtn = document.createElement('button');
    actionBtn.className = 'btn btn-primary btn-sm';
    actionBtn.textContent = options.actionText;
    actionBtn.style.padding = '2px 8px';
    actionBtn.style.fontSize = '11px';
    actionBtn.onclick = () => {
      options.onAction();
      toast.remove();
    };
    toast.appendChild(actionBtn);
  }

  container.appendChild(toast);

  const duration = options.duration || 4500;
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 200ms ease';
    setTimeout(() => toast.remove(), 250);
  }, duration);
}

/**
 * First-run educational prototype disclaimer modal
 */
export function checkFirstRunModal() {
  const seen = localStorage.getItem('finpilot_first_run_seen');
  const modal = document.getElementById('modal-first-run');
  if (!seen && modal) {
    modal.classList.add('open');
    document.getElementById('btn-dismiss-first-run')?.addEventListener('click', () => {
      modal.classList.remove('open');
      localStorage.setItem('finpilot_first_run_seen', 'true');
    });
  }
}

/**
 * Inspection modal explaining exactly how a KPI or metric is computed
 */
export function showCalculationModal(title, { formula, inputs, explanation, transactionsUsed }) {
  const modal = document.getElementById('modal-calculation');
  const titleEl = document.getElementById('calc-modal-title');
  const contentEl = document.getElementById('calc-modal-content');

  if (!modal || !contentEl) return;

  titleEl.textContent = `Calculation: ${title}`;
  contentEl.innerHTML = `
    <div>
      <h4 style="font-size: var(--text-sm); font-weight: 600; margin-bottom: 6px;">Formula:</h4>
      <div class="formula-box">${formula}</div>
    </div>
    <div>
      <h4 style="font-size: var(--text-sm); font-weight: 600; margin-bottom: 6px;">Inputs & Deterministic Arithmetic:</h4>
      <p style="font-size: var(--text-xs); color: var(--text-secondary); line-height: 1.5;">${explanation}</p>
    </div>
    ${inputs ? `
      <div>
        <h4 style="font-size: var(--text-sm); font-weight: 600; margin-bottom: 6px;">Values:</h4>
        <pre style="background: var(--bg-surface-elevated); padding: 10px; border-radius: var(--radius-sm); font-size: 11px; overflow-x: auto;">${JSON.stringify(inputs, null, 2)}</pre>
      </div>
    ` : ''}
    ${transactionsUsed ? `
      <div style="font-size: 11px; color: var(--text-muted);">
        Verified against <strong>${transactionsUsed}</strong> transactions in the active period.
      </div>
    ` : ''}
  `;

  modal.classList.add('open');
}
