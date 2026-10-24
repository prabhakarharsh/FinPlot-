// public/js/chat.js
// Munim AI Copilot Frontend Controller for FinPilot
// Stitch Paper & Ink Slide-Over Interface with SSE Streaming, Source Chips & Action Proposals

import { state } from './state.js';
import { api } from './api.js';
import { showToast, showCalculationModal } from './ui.js';
import { renderIcons } from './icons.js';

let activeConversationId = null;
let isStreaming = false;
let currentAbortController = null;
let conversationsList = [];

/**
 * Context starter suggestions mapped by view
 */
const VIEW_STARTERS = {
  dashboard: [
    'Where did I overspend this month?',
    'How is my savings rate?',
    'What are my top 3 expenses?',
    'How much did I spend on food and dining?'
  ],
  transactions: [
    'Show my transactions above ₹5,000',
    'How much did I spend on Swiggy?',
    'Find all Amazon purchases',
    'What did I spend last weekend?'
  ],
  recurring: [
    'Which subscription costs the most?',
    'What is my total monthly recurring bill?',
    'Show all active recurring commitments',
    'Are there any annual subscriptions due soon?'
  ],
  flags: [
    'Why was this transaction flagged for review?',
    'Are there any potential duplicate charges?',
    'Show all transactions with high price changes',
    'Explain the review criteria for flagged items'
  ],
  goals: [
    'Can I reach my Emergency Fund goal sooner?',
    'What if I cut Dining by 20%?',
    'How much should I save monthly for my goal?',
    'Run a scenario with ₹5,000 extra monthly income'
  ]
};

/**
 * Initialize Munim Chat System
 */
export function initChat() {
  injectMunimDOM();
  bindMunimEvents();
  renderStarterChips();
}

/**
 * Inject Slide-Over Drawer & Floating Action Button
 */
function injectMunimDOM() {
  if (document.getElementById('munim-drawer-overlay')) return;

  const html = `
    <!-- Floating Munim Launch Button -->
    <button id="btn-munim-floating" class="munim-floating-btn" aria-label="Open Munim Financial Copilot">
      <div class="munim-stamp-avatar" style="width: 28px; height: 28px; font-size: 14px; border-width: 1.5px;">म</div>
      <span>Ask Munim</span>
    </button>

    <!-- Slide-Over Drawer Overlay -->
    <div id="munim-drawer-overlay" class="munim-drawer-overlay" role="dialog" aria-modal="true" aria-label="Munim AI Assistant">
      <div class="munim-panel">
        
        <!-- Drawer Header -->
        <div class="munim-header">
          <div class="munim-header-title">
            <div class="munim-stamp-avatar">म</div>
            <div>
              <div class="munim-title-text">Munim</div>
              <div class="munim-subtitle-text" id="munim-header-sub">Grounded in your own numbers</div>
            </div>
          </div>
          <div class="munim-header-actions">
            <button id="btn-munim-history-toggle" class="btn btn-ghost btn-sm btn-icon" title="Chat History" aria-label="Chat History">
              <i data-lucide="database"></i>
            </button>
            <button id="btn-munim-new-chat" class="btn btn-ghost btn-sm btn-icon" title="New Conversation" aria-label="New Conversation">
              <i data-lucide="plus"></i>
            </button>
            <button id="btn-munim-close" class="btn btn-ghost btn-sm btn-icon" title="Close Munim (Esc)" aria-label="Close Munim">
              <i data-lucide="x"></i>
            </button>
          </div>
        </div>

        <!-- History Drawer -->
        <div id="munim-history-drawer" class="munim-history-drawer">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
            <span style="font-weight: 700; font-size: var(--text-xs); text-transform: uppercase; color: var(--munim-terracotta);">Conversations</span>
            <button id="btn-close-history" class="btn btn-ghost btn-sm" style="padding: 2px 6px; font-size: 11px;">Close</button>
          </div>
          <div id="munim-history-list">
            <!-- Dynamically populated -->
          </div>
        </div>

        <!-- Messages Thread -->
        <div id="munim-messages-container" class="munim-messages-container" aria-live="polite">
          <!-- Empty State Greeting -->
          <div id="munim-empty-state" style="text-align: center; margin: auto 0; padding: 24px 12px;">
            <div class="munim-stamp-avatar" style="width: 54px; height: 54px; font-size: 26px; margin: 0 auto 16px;">म</div>
            <h3 style="font-family: 'Fraunces', Georgia, serif; font-size: 1.25rem; font-weight: 700; margin-bottom: 6px; color: var(--munim-terracotta);">Namaste, I am Munim.</h3>
            <p style="font-size: var(--text-xs); color: var(--munim-ink-muted); line-height: 1.6; max-width: 320px; margin: 0 auto 16px;">
              Your personal finance copilot. I never guess or do math in my head—every number comes directly from your bank records.
            </p>
            <div style="font-size: 11px; background: rgba(194, 65, 12, 0.08); padding: 6px 12px; border-radius: 9999px; display: inline-block; color: var(--munim-terracotta); font-weight: 600;">
              Zero credentials required · Traceable numbers
            </div>
          </div>
        </div>

        <!-- Status Line -->
        <div id="munim-status-line" class="munim-status-line" style="display: none; margin: 0 20px;">
          <div class="munim-spinner"></div>
          <span id="munim-status-text">Thinking...</span>
        </div>

        <!-- Context Starter Chips -->
        <div id="munim-starters-wrap" class="munim-starters-wrap">
          <!-- Populated dynamically -->
        </div>

        <!-- Chat Input Form -->
        <div class="munim-input-area">
          <form id="munim-chat-form">
            <div class="munim-input-box">
              <textarea
                id="munim-input"
                class="munim-textarea"
                rows="1"
                placeholder="Ask about your spending, goals, or bills..."
                required
                aria-label="Message Munim"
              ></textarea>
              <button type="submit" id="btn-munim-send" class="munim-send-btn" title="Send (Enter)">
                <i data-lucide="send" style="width: 14px; height: 14px;"></i>
              </button>
              <button type="button" id="btn-munim-stop" class="munim-send-btn munim-stop-btn" style="display: none;" title="Stop Generating">
                <i data-lucide="x" style="width: 14px; height: 14px;"></i>
              </button>
            </div>
            <div class="munim-disclaimer">
              Educational prototype. Not regulated financial advice.
            </div>
          </form>
        </div>

      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', html);
  renderIcons();
}

/**
 * Bind UI Events
 */
function bindMunimEvents() {
  const overlay = document.getElementById('munim-drawer-overlay');
  const openBtn = document.getElementById('btn-munim-floating');
  const closeBtn = document.getElementById('btn-munim-close');
  const headerCopilotBtn = document.getElementById('btn-header-copilot');
  const sidebarCopilotBtn = document.getElementById('btn-open-chat-sidebar');
  const newChatBtn = document.getElementById('btn-munim-new-chat');
  const historyToggleBtn = document.getElementById('btn-munim-history-toggle');
  const closeHistoryBtn = document.getElementById('btn-close-history');
  const form = document.getElementById('munim-chat-form');
  const input = document.getElementById('munim-input');
  const stopBtn = document.getElementById('btn-munim-stop');

  const openDrawer = () => {
    overlay.classList.add('open');
    renderStarterChips();
    input.focus();
    loadConversationsList();
  };

  const closeDrawer = () => {
    overlay.classList.remove('open');
    document.getElementById('munim-history-drawer')?.classList.remove('open');
  };

  openBtn?.addEventListener('click', openDrawer);
  headerCopilotBtn?.addEventListener('click', openDrawer);
  sidebarCopilotBtn?.addEventListener('click', openDrawer);
  closeBtn?.addEventListener('click', closeDrawer);

  overlay?.addEventListener('click', (e) => {
    if (e.target === overlay) closeDrawer();
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay.classList.contains('open')) {
      closeDrawer();
    }
  });

  newChatBtn?.addEventListener('click', () => {
    startNewConversation();
  });

  historyToggleBtn?.addEventListener('click', () => {
    const drawer = document.getElementById('munim-history-drawer');
    drawer.classList.toggle('open');
  });

  closeHistoryBtn?.addEventListener('click', () => {
    document.getElementById('munim-history-drawer')?.classList.remove('open');
  });

  // Auto-resize textarea and Enter/Shift+Enter handler
  input?.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  });

  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  stopBtn?.addEventListener('click', () => {
    if (currentAbortController) {
      currentAbortController.abort();
      setStreamingState(false);
      showToast('Generation stopped.');
    }
  });

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || isStreaming) return;
    input.value = '';
    input.style.height = 'auto';
    await sendUserMessage(text);
  });

  // Update starter chips when route hash changes
  window.addEventListener('hashchange', () => {
    renderStarterChips();
  });
}

/**
 * Render Context Starter Chips based on current active view
 */
function renderStarterChips() {
  const wrap = document.getElementById('munim-starters-wrap');
  if (!wrap) return;

  const currentView = window.location.hash.replace('#', '') || 'dashboard';
  const starters = VIEW_STARTERS[currentView] || VIEW_STARTERS.dashboard;

  wrap.innerHTML = starters.map(q => `
    <button type="button" class="munim-starter-chip" data-question="${escapeHtml(q)}">
      ${escapeHtml(q)}
    </button>
  `).join('');

  wrap.querySelectorAll('.munim-starter-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const q = btn.getAttribute('data-question');
      const input = document.getElementById('munim-input');
      input.value = q;
      input.focus();
      document.getElementById('munim-chat-form')?.requestSubmit();
    });
  });
}

/**
 * Start New Chat
 */
function startNewConversation() {
  activeConversationId = null;
  const container = document.getElementById('munim-messages-container');
  container.innerHTML = `
    <div id="munim-empty-state" style="text-align: center; margin: auto 0; padding: 24px 12px;">
      <div class="munim-stamp-avatar" style="width: 54px; height: 54px; font-size: 26px; margin: 0 auto 16px;">म</div>
      <h3 style="font-family: 'Fraunces', Georgia, serif; font-size: 1.25rem; font-weight: 700; margin-bottom: 6px; color: var(--munim-terracotta);">Namaste, I am Munim.</h3>
      <p style="font-size: var(--text-xs); color: var(--munim-ink-muted); line-height: 1.6; max-width: 320px; margin: 0 auto 16px;">
        Your personal finance copilot. I never guess or do math in my head—every number comes directly from your bank records.
      </p>
    </div>
  `;
  document.getElementById('munim-history-drawer')?.classList.remove('open');
  renderStarterChips();
  showToast('Started new conversation.');
}

/**
 * Send User Message and Stream Response
 */
export async function sendUserMessage(messageText) {
  const cleanMsg = (messageText || '').trim();
  if (!cleanMsg) return;

  const container = document.getElementById('munim-messages-container');
  document.getElementById('munim-empty-state')?.remove();

  // 1. Append User Bubble
  appendMessageUI({ role: 'user', content: cleanMsg });

  // 2. Setup Assistant Stream Placeholder
  const assistantBubble = appendMessageUI({ role: 'assistant', content: '', isPlaceholder: true });
  const textBodyEl = assistantBubble.querySelector('.munim-text-content');

  setStreamingState(true);
  currentAbortController = new AbortController();

  let accumulatedText = '';
  let turnSources = [];
  let turnProposals = [];
  let isVerified = true;

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.getUserToken()}`,
        'X-User-Id': state.currentUser?.id || 'demo-user-1',
        'X-User-Email': state.currentUser?.email || 'demo@finpilot.local'
      },
      body: JSON.stringify({
        conversation_id: activeConversationId || null,
        message: cleanMsg,
        transactions: Array.isArray(state.transactions) ? state.transactions : [],
        goals: Array.isArray(state.goals) ? state.goals : [],
        categories: Array.isArray(state.categories) ? state.categories : []
      }),
      signal: currentAbortController.signal
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({ error: `Server error: ${res.status}` }));
      throw new Error(errJson.error || `HTTP ${res.status}`);
    }

    // Read SSE Stream via ReadableStream
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      let currentEvent = 'message';
      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEvent = line.slice(7).trim();
        } else if (line.startsWith('data: ')) {
          const rawData = line.slice(6).trim();
          if (!rawData) continue;

          try {
            const parsed = JSON.parse(rawData);

            if (currentEvent === 'status') {
              showStatusLine(parsed.message);
              if (parsed.conversation_id) activeConversationId = parsed.conversation_id;
            } else if (currentEvent === 'text') {
              hideStatusLine();
              accumulatedText += parsed.delta;
              textBodyEl.innerHTML = formatMarkdown(accumulatedText);
              scrollToBottom();
            } else if (currentEvent === 'sources') {
              turnSources = parsed;
            } else if (currentEvent === 'proposal') {
              turnProposals.push(parsed);
            } else if (currentEvent === 'verified') {
              isVerified = parsed.verified;
            } else if (currentEvent === 'done') {
              if (parsed.content) {
                accumulatedText = parsed.content;
                textBodyEl.innerHTML = formatMarkdown(accumulatedText);
              }
            } else if (currentEvent === 'error') {
              throw new Error(parsed.error);
            }
          } catch (e) {
            console.warn('[Munim SSE Chunk Parse Error]', e);
          }
        }
      }
    }

    // Render sources and proposals under the assistant bubble
    renderAssistantExtras(assistantBubble, turnSources, turnProposals, isVerified);
    renderIcons();
    scrollToBottom();

  } catch (err) {
    if (err.name === 'AbortError') {
      textBodyEl.innerHTML = formatMarkdown(accumulatedText + '\n\n*(Generation stopped by user)*');
    } else {
      textBodyEl.innerHTML = `<span style="color: var(--accent-expense);">Munim is taking a break. ${escapeHtml(err.message)}</span>`;
    }
  } finally {
    setStreamingState(false);
    hideStatusLine();
    loadConversationsList();
  }
}

/**
 * Append Message Bubble to UI
 */
function appendMessageUI({ role, content, isPlaceholder = false }) {
  const container = document.getElementById('munim-messages-container');
  const msgRow = document.createElement('div');
  msgRow.className = `munim-msg-row ${role === 'user' ? 'munim-msg-user' : 'munim-msg-assistant'}`;

  if (role === 'user') {
    msgRow.textContent = content;
  } else {
    msgRow.innerHTML = `
      <div class="munim-text-content">${formatMarkdown(content)}</div>
      <div class="munim-extras-wrap"></div>
      <div class="munim-msg-footer">
        <span style="font-family: 'Fraunces', serif; color: var(--munim-terracotta);">Munim</span>
        <div class="munim-msg-actions">
          <button type="button" class="munim-icon-btn btn-copy-msg" title="Copy reply"><i data-lucide="copy" style="width: 12px;"></i></button>
          <button type="button" class="munim-icon-btn btn-thumb-up" title="Helpful"><i data-lucide="check" style="width: 12px;"></i></button>
        </div>
      </div>
    `;

    // Copy action
    msgRow.querySelector('.btn-copy-msg')?.addEventListener('click', () => {
      const text = msgRow.querySelector('.munim-text-content').textContent;
      navigator.clipboard.writeText(text);
      showToast('Copied to clipboard');
    });

    // Helpful feedback
    msgRow.querySelector('.btn-thumb-up')?.addEventListener('click', () => {
      showToast('Thank you for your feedback!');
    });
  }

  container.appendChild(msgRow);
  scrollToBottom();
  return msgRow;
}

/**
 * Render Extras: Source Chips, Calculation Panel Link, Action Proposals, Unverified Badge
 */
function renderAssistantExtras(msgRow, sources = [], proposals = [], isVerified = true) {
  const extrasWrap = msgRow.querySelector('.munim-extras-wrap');
  if (!extrasWrap) return;

  let html = '';

  // 1. Unverified warning badge if applicable
  if (!isVerified) {
    html += `
      <div class="munim-unverified-note">
        <i data-lucide="alert-triangle" style="width: 12px; color: var(--munim-saffron);"></i>
        <span>I couldn't double-check every number here. Tap a source to verify.</span>
      </div>
    `;
  }

  // 2. Action Proposal Cards
  if (proposals.length > 0) {
    proposals.forEach(prop => {
      html += `
        <div class="munim-proposal-card" id="prop-card-${prop.proposal_id}">
          <div class="munim-proposal-title">Action Proposal</div>
          <div class="munim-proposal-desc">${escapeHtml(prop.summary || 'Proposed adjustment based on your request')}</div>
          <div class="munim-proposal-actions">
            <button type="button" class="btn btn-primary btn-sm btn-confirm-prop" data-prop-id="${prop.proposal_id}">
              <i data-lucide="check" style="width: 12px;"></i> Yes, apply
            </button>
            <button type="button" class="btn btn-ghost btn-sm btn-dismiss-prop" data-prop-id="${prop.proposal_id}">
              Not now
            </button>
          </div>
        </div>
      `;
    });
  }

  // 3. Source Chips
  if (sources.length > 0) {
    html += `<div class="munim-sources-bar">`;
    sources.slice(0, 8).forEach(s => {
      if (s.type === 'txn') {
        html += `
          <button type="button" class="munim-source-chip" data-txn-id="${s.id}" title="Click to view in Transactions">
            <i data-lucide="arrow-left-right" style="width: 10px;"></i>
            <span>${escapeHtml(s.label || `Txn: ${s.id}`)}</span>
          </button>
        `;
      } else if (s.type === 'calc') {
        html += `
          <button type="button" class="munim-source-chip munim-source-calc" data-calc-id="${s.id}" data-assumptions="${escapeHtml(JSON.stringify(s.assumptions || []))}" title="How I calculated this">
            <i data-lucide="calculator" style="width: 10px;"></i>
            <span>How I calculated this</span>
          </button>
        `;
      }
    });
    html += `</div>`;
  }

  extrasWrap.innerHTML = html;

  // Bind proposal confirm/dismiss actions
  extrasWrap.querySelectorAll('.btn-confirm-prop').forEach(btn => {
    btn.addEventListener('click', async () => {
      const propId = btn.getAttribute('data-prop-id');
      const card = document.getElementById(`prop-card-${propId}`);
      btn.disabled = true;
      btn.textContent = 'Applying...';

      try {
        const res = await fetch(`/api/chat/proposals/${propId}/confirm`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${state.getUserToken()}`,
            'X-User-Id': state.currentUser?.id || 'demo-user-1'
          }
        });
        const data = await res.json();
        if (card) {
          card.innerHTML = `
            <div style="color: var(--accent-income); font-weight: 600; font-size: var(--text-xs); display: flex; align-items: center; gap: 6px;">
              <i data-lucide="check-circle" style="width: 14px;"></i>
              <span>${escapeHtml(data.message || 'Action applied successfully!')}</span>
            </div>
          `;
          renderIcons();
        }
        await api.loadUserData();
        showToast(data.message || 'Action confirmed!');
      } catch (e) {
        showToast('Failed to apply proposal: ' + e.message, 'error');
      }
    });
  });

  extrasWrap.querySelectorAll('.btn-dismiss-prop').forEach(btn => {
    btn.addEventListener('click', () => {
      const propId = btn.getAttribute('data-prop-id');
      const card = document.getElementById(`prop-card-${propId}`);
      if (card) card.remove();
      showToast('Proposal dismissed.');
    });
  });

  // Bind transaction chips click: jump to transactions view and highlight
  extrasWrap.querySelectorAll('[data-txn-id]').forEach(chip => {
    chip.addEventListener('click', () => {
      const txnId = chip.getAttribute('data-txn-id');
      window.location.hash = '#transactions';
      document.getElementById('munim-drawer-overlay')?.classList.remove('open');
      setTimeout(() => {
        const targetRow = document.querySelector(`[data-txn-row-id="${txnId}"]`);
        if (targetRow) {
          targetRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
          targetRow.style.backgroundColor = 'var(--accent-primary-subtle)';
          setTimeout(() => { targetRow.style.backgroundColor = ''; }, 3000);
        }
      }, 300);
    });
  });

  // Bind calculation chip click: open "Show Calculation" panel
  extrasWrap.querySelectorAll('[data-calc-id]').forEach(chip => {
    chip.addEventListener('click', () => {
      const calcId = chip.getAttribute('data-calc-id');
      let assumptions = [];
      try {
        assumptions = JSON.parse(chip.getAttribute('data-assumptions') || '[]');
      } catch {
        assumptions = [];
      }

      showCalculationModal({
        title: 'How Munim Calculated This',
        formula: 'Deterministic integer cents summation & categorization rules (shared/engine.js)',
        inputs: {
          calculation_id: calcId,
          data_source: state.isSampleData ? 'Sample Bank Transactions' : 'Imported Records'
        },
        assumptions: assumptions.length ? assumptions : [
          'Transfers between own accounts are excluded from expenditure',
          'Exact currency values computed with zero floating point drift'
        ]
      });
    });
  });
}

/**
 * Load Conversation History List
 */
async function loadConversationsList() {
  const listEl = document.getElementById('munim-history-list');
  if (!listEl) return;

  try {
    const res = await fetch('/api/chat/conversations', {
      headers: {
        'Authorization': `Bearer ${state.getUserToken()}`,
        'X-User-Id': state.currentUser?.id || 'demo-user-1'
      }
    });
    const data = await res.json();
    conversationsList = data.conversations || [];

    if (!conversationsList.length) {
      listEl.innerHTML = `<div style="font-size: 11px; color: var(--munim-ink-muted); padding: 8px;">No previous conversations.</div>`;
      return;
    }

    listEl.innerHTML = conversationsList.map(c => `
      <div class="munim-history-item" data-conv-id="${c.id}">
        <span style="font-weight: 500; truncate;">${escapeHtml(c.title || 'Conversation')}</span>
        <button type="button" class="btn btn-ghost btn-sm btn-delete-conv" data-delete-id="${c.id}" style="padding: 2px 4px; color: var(--accent-expense);">
          <i data-lucide="trash-2" style="width: 12px;"></i>
        </button>
      </div>
    `).join('');

    renderIcons();

    // Switch conversation
    listEl.querySelectorAll('.munim-history-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.closest('.btn-delete-conv')) return;
        const convId = item.getAttribute('data-conv-id');
        loadSpecificConversation(convId);
      });
    });

    // Delete conversation
    listEl.querySelectorAll('.btn-delete-conv').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const convId = btn.getAttribute('data-delete-id');
        if (confirm('Delete this conversation?')) {
          await fetch(`/api/chat/conversations/${convId}`, {
            method: 'DELETE',
            headers: {
              'Authorization': `Bearer ${state.getUserToken()}`,
              'X-User-Id': state.currentUser?.id || 'demo-user-1'
            }
          });
          if (activeConversationId === convId) startNewConversation();
          loadConversationsList();
        }
      });
    });
  } catch (e) {
    console.warn('[Munim History Load Error]', e);
  }
}

/**
 * Load Specific Conversation Messages
 */
async function loadSpecificConversation(convId) {
  activeConversationId = convId;
  document.getElementById('munim-history-drawer')?.classList.remove('open');
  const container = document.getElementById('munim-messages-container');
  container.innerHTML = `<div style="text-align: center; padding: 24px; font-size: 12px; color: var(--munim-ink-muted);">Loading conversation...</div>`;

  try {
    const res = await fetch(`/api/chat/conversations/${convId}`, {
      headers: {
        'Authorization': `Bearer ${state.getUserToken()}`,
        'X-User-Id': state.currentUser?.id || 'demo-user-1'
      }
    });
    const data = await res.json();
    container.innerHTML = '';

    (data.messages || []).forEach(m => {
      const bubble = appendMessageUI({ role: m.role, content: m.content });
      if (m.role === 'assistant') {
        renderAssistantExtras(bubble, m.sources || [], [], m.verified ?? true);
      }
    });

    renderIcons();
    scrollToBottom();
  } catch (e) {
    showToast('Failed to load conversation: ' + e.message, 'error');
  }
}

/**
 * Helper Utilities
 */
function setStreamingState(streaming) {
  isStreaming = streaming;
  const sendBtn = document.getElementById('btn-munim-send');
  const stopBtn = document.getElementById('btn-munim-stop');
  if (sendBtn) sendBtn.style.display = streaming ? 'none' : 'flex';
  if (stopBtn) stopBtn.style.display = streaming ? 'flex' : 'none';
}

function showStatusLine(text) {
  const line = document.getElementById('munim-status-line');
  const statusText = document.getElementById('munim-status-text');
  if (line && statusText) {
    statusText.textContent = text;
    line.style.display = 'flex';
  }
}

function hideStatusLine() {
  const line = document.getElementById('munim-status-line');
  if (line) line.style.display = 'none';
}

function scrollToBottom() {
  const container = document.getElementById('munim-messages-container');
  if (container) container.scrollTop = container.scrollHeight;
}

function escapeHtml(text = '') {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatMarkdown(text = '') {
  let safe = escapeHtml(text);
  // Bold: **text**
  safe = safe.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  // Italic: *text*
  safe = safe.replace(/\*(.*?)\*/g, '<em>$1</em>');
  // Bullet lists
  safe = safe.replace(/^[•\-]\s+(.*)$/gm, '<li>$1</li>');
  safe = safe.replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>');
  // Linebreaks
  safe = safe.replace(/\n\n/g, '<br><br>').replace(/\n/g, '<br>');
  return safe;
}
