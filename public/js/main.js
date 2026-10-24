// public/js/main.js
// Main entrypoint for FinPilot client-side application

import { state } from './state.js';
import { api } from './api.js';
import { renderIcons } from './icons.js';
import { initAccountModal, updateUserBadgeUI, openAccountModal } from './accounts.js';
import { initTheme, toggleTheme, checkFirstRunModal } from './ui.js';
import { initDashboard } from './dashboard.js';
import { initTransactions } from './transactions.js';
import { initRecurring } from './recurring.js';
import { initFlags } from './flags.js';
import { initGoals } from './goals.js';
import { initScenarios } from './scenarios.js';
import { initImport } from './import.js';
import { initChat } from './chat.js';
import { initSetupWizard } from './setup_wizard.js';
import { initVoice } from './voice.js';

document.addEventListener('DOMContentLoaded', async () => {
  // 1. Initialize Theme & Safe Icons (works 100% offline and standalone)
  initTheme();
  renderIcons();

  // 2. First Run Disclaimer Modal
  checkFirstRunModal();

  // 3. Theme Toggle Buttons
  document.getElementById('btn-theme-toggle')?.addEventListener('click', () => {
    toggleTheme();
    renderIcons();
  });

  // 4. Period Selector Listener
  document.getElementById('period-selector')?.addEventListener('change', (e) => {
    state.setActivePeriod(e.target.value);
  });

  // 5. User Account Profile & Switcher Modals
  initAccountModal();
  document.getElementById('btn-header-profile')?.addEventListener('click', openAccountModal);
  document.getElementById('user-badge-sidebar')?.addEventListener('click', openAccountModal);

  // 6. Logout Listeners (Sidebar and Header)
  const handleLogout = async () => {
    if (confirm('Sign out and lock session?')) {
      await api.signOut();
    }
  };
  document.getElementById('btn-logout')?.addEventListener('click', handleLogout);
  document.getElementById('btn-header-logout')?.addEventListener('click', handleLogout);

  // 7. Router & Navigation Setup
  setupNavigation();

  // 8. Initialize Backend API Connection & Auth Guard
  await api.init();

  if (!api.isAuthenticated()) {
    window.location.href = 'login.html';
    return;
  }

  // Update user badge in UI
  updateUserBadgeUI();

  // 9. Load User Data (or default sample transactions)
  await api.loadUserData();

  // Update user badge again with transaction stats
  updateUserBadgeUI();

  // 10. Initialize Sub-modules
  initDashboard();
  initTransactions();
  initRecurring();
  initFlags();
  initGoals();
  initScenarios();
  initImport();
  initChat();
  initSetupWizard();
  initVoice();

  // Re-render icons across loaded dynamic modules
  renderIcons();

  // Initial Route Dispatch
  handleHashChange();
});

function setupNavigation() {
  window.addEventListener('hashchange', handleHashChange);

  // Attach clicks to sidebar and mobile navigation links
  document.querySelectorAll('[data-view]').forEach(link => {
    link.addEventListener('click', (e) => {
      const view = link.getAttribute('data-view');
      window.location.hash = `#${view}`;
    });
  });
}

function handleHashChange() {
  const hash = window.location.hash.replace('#', '') || 'dashboard';
  const validViews = ['dashboard', 'transactions', 'recurring', 'flags', 'goals', 'import'];
  const activeView = validViews.includes(hash) ? hash : 'dashboard';

  // Toggle active view sections
  validViews.forEach(v => {
    const section = document.getElementById(`view-${v}`);
    if (section) {
      section.style.display = (v === activeView) ? 'block' : 'none';
    }
  });

  // Update active links in desktop sidebar & mobile nav
  document.querySelectorAll('[data-view]').forEach(link => {
    const linkView = link.getAttribute('data-view');
    if (linkView === activeView) {
      link.classList.add('active');
    } else {
      link.classList.remove('active');
    }
  });

  // Update page header title
  const pageTitle = document.getElementById('page-title');
  if (pageTitle) {
    const titles = {
      dashboard: 'Dashboard',
      transactions: 'Transactions',
      recurring: 'Recurring Payments & Bills',
      flags: 'Review Flags',
      goals: 'Goals & What-If Scenarios',
      import: 'Import Data'
    };
    pageTitle.textContent = titles[activeView] || 'Dashboard';
  }

  // Scroll to top
  window.scrollTo({ top: 0, behavior: 'instant' });
}
