// public/js/voice.js
// Voice Speech-to-Transaction & Text-to-Speech Engine for FinPilot
// Enables hands-free natural voice logging of expenses, income, and queries.

import { state } from './state.js';
import { api } from './api.js';
import { formatINR, showToast } from './ui.js';
import { renderIcons } from './icons.js';
import { parseVoiceTransaction } from '../../shared/nlp_transaction_parser.js';
import { DEFAULT_CATEGORIES } from '../../shared/constants.js';

let recognition = null;
let isListening = false;
let autoSaveTimer = null;
let activeParsedResult = null;
let currentLanguage = localStorage.getItem('finpilot_voice_lang') || 'en-IN';
let isTtsEnabled = localStorage.getItem('finpilot_voice_tts') !== 'false';

// Check browser SpeechRecognition support
export function isSpeechSupported() {
  return typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);
}

// Speak aloud using Web SpeechSynthesis API
export function speakText(text) {
  if (!isTtsEnabled || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel(); // Stop any pending speech
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = currentLanguage;
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    window.speechSynthesis.speak(utterance);
  } catch (err) {
    console.warn('[Voice] Speech synthesis error:', err);
  }
}

// Initialize Speech Recognition instance
function getRecognitionInstance() {
  if (recognition) return recognition;
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) return null;

  recognition = new SpeechRec();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = currentLanguage;

  return recognition;
}

// Initialize Voice UI components and listeners
export function initVoice() {
  const modal = document.getElementById('modal-voice-transaction');
  const btnHeaderVoice = document.getElementById('btn-header-voice-tx');
  const btnModalVoiceInput = document.getElementById('btn-modal-voice-input');
  const btnChatMic = document.getElementById('btn-chat-mic');
  const btnVoiceAddTx = document.getElementById('btn-voice-add-transaction');

  // Open modal from Header button
  btnHeaderVoice?.addEventListener('click', () => {
    openVoiceModal();
  });

  // Open modal from Dashboard onboarding quick step card
  document.getElementById('btn-quick-voice-add')?.addEventListener('click', () => {
    openVoiceModal();
  });

  // Open modal from Transactions table view
  btnVoiceAddTx?.addEventListener('click', () => {
    openVoiceModal();
  });

  // "Speak to Fill" in traditional Add Transaction modal
  btnModalVoiceInput?.addEventListener('click', () => {
    openVoiceModal({ fillFormOnly: true });
  });

  // Close modal buttons
  document.getElementById('btn-close-voice-modal')?.addEventListener('click', closeVoiceModal);
  document.getElementById('btn-cancel-voice')?.addEventListener('click', closeVoiceModal);

  // Big Mic toggle in modal
  document.getElementById('btn-voice-record-toggle')?.addEventListener('click', () => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  });

  // Language selector change
  const langSelect = document.getElementById('voice-lang-select');
  if (langSelect) {
    langSelect.value = currentLanguage;
    langSelect.addEventListener('change', (e) => {
      currentLanguage = e.target.value;
      localStorage.setItem('finpilot_voice_lang', currentLanguage);
      if (recognition) {
        recognition.lang = currentLanguage;
        if (isListening) {
          stopListening();
          startListening();
        }
      }
    });
  }

  // TTS Voice feedback toggle
  const ttsToggle = document.getElementById('voice-tts-toggle');
  if (ttsToggle) {
    ttsToggle.checked = isTtsEnabled;
    ttsToggle.addEventListener('change', (e) => {
      isTtsEnabled = e.target.checked;
      localStorage.setItem('finpilot_voice_tts', isTtsEnabled ? 'true' : 'false');
    });
  }

  // Manual input fallback typing
  const manualInput = document.getElementById('voice-manual-input');
  manualInput?.addEventListener('input', (e) => {
    handleVoiceTranscript(e.target.value, false);
  });

  // Confirm and Save transaction
  document.getElementById('btn-confirm-voice-save')?.addEventListener('click', async () => {
    await saveActiveParsedTransaction();
  });

  // Hook up voice mic for Munim Copilot Chat input
  if (btnChatMic) {
    btnChatMic.addEventListener('click', (e) => {
      e.preventDefault();
      toggleChatMic();
    });
  }
}

let isFillFormOnly = false;

// Open the Voice Transaction Modal
export function openVoiceModal(options = {}) {
  const modal = document.getElementById('modal-voice-transaction');
  if (!modal) return;

  isFillFormOnly = !!options.fillFormOnly;
  modal.classList.add('open');
  activeParsedResult = null;
  clearTimeout(autoSaveTimer);

  const transcriptEl = document.getElementById('voice-live-transcript');
  const previewCard = document.getElementById('voice-preview-card');
  const manualInput = document.getElementById('voice-manual-input');
  const confirmBtn = document.getElementById('btn-confirm-voice-save');

  if (transcriptEl) transcriptEl.textContent = 'Listening... Speak naturally (e.g., "300 for shopping" or "500 petrol")';
  if (previewCard) previewCard.style.display = 'none';
  if (manualInput) manualInput.value = '';
  if (confirmBtn) confirmBtn.disabled = true;

  renderIcons(modal);

  // Automatically start listening if speech API is supported
  if (isSpeechSupported()) {
    startListening();
  } else {
    updateVoiceStatus('Browser speech recognition not supported. Type your transaction above.', false);
  }
}

// Close the Voice Transaction Modal
export function closeVoiceModal() {
  const modal = document.getElementById('modal-voice-transaction');
  if (modal) modal.classList.remove('open');
  stopListening();
  clearTimeout(autoSaveTimer);
}

// Start Speech Recognition
function startListening() {
  if (!isSpeechSupported()) {
    showToast('Voice speech recognition is not supported in this browser. Please type phrase.', { type: 'error' });
    return;
  }

  const rec = getRecognitionInstance();
  if (!rec) return;

  try {
    rec.start();
    isListening = true;
    updateMicVisuals(true);
    updateVoiceStatus('Listening... Speak your amount and purpose now', true);
  } catch (err) {
    console.warn('[Voice] Recognition start error:', err);
    // If already started, just set state
    isListening = true;
    updateMicVisuals(true);
  }

  rec.onresult = (event) => {
    let interimTranscript = '';
    let finalTranscript = '';

    for (let i = event.resultIndex; i < event.results.length; ++i) {
      if (event.results[i].isFinal) {
        finalTranscript += event.results[i][0].transcript;
      } else {
        interimTranscript += event.results[i][0].transcript;
      }
    }

    const currentText = (finalTranscript || interimTranscript).trim();
    if (currentText) {
      handleVoiceTranscript(currentText, Boolean(finalTranscript));
    }
  };

  rec.onerror = (event) => {
    console.warn('[Voice] Recognition error:', event.error);
    if (event.error === 'not-allowed') {
      updateVoiceStatus('Microphone permission denied. Allow mic in browser settings or type below.', false);
      stopListening();
    } else if (event.error === 'no-speech') {
      updateVoiceStatus('No speech detected. Please speak clearly into your mic.', true);
    }
  };

  rec.onend = () => {
    if (isListening) {
      // Keep listening unless explicitly stopped
      try {
        rec.start();
      } catch (e) {
        isListening = false;
        updateMicVisuals(false);
      }
    } else {
      updateMicVisuals(false);
    }
  };
}

// Stop Speech Recognition
function stopListening() {
  isListening = false;
  if (recognition) {
    try {
      recognition.stop();
    } catch (e) {}
  }
  updateMicVisuals(false);
}

// Process spoken text and extract transaction details
function handleVoiceTranscript(text, isFinal = false) {
  const transcriptEl = document.getElementById('voice-live-transcript');
  if (transcriptEl) {
    transcriptEl.textContent = `"${text}"`;
  }

  // Parse transaction using our NLP engine
  const parsed = parseVoiceTransaction(text, { userRules: state.rules });
  activeParsedResult = parsed;

  const previewCard = document.getElementById('voice-preview-card');
  const confirmBtn = document.getElementById('btn-confirm-voice-save');

  if (parsed.ok && parsed.transaction) {
    renderParsedPreview(parsed.transaction);
    if (previewCard) previewCard.style.display = 'block';
    if (confirmBtn) confirmBtn.disabled = false;
    updateVoiceStatus('✓ Got it! Review details below and confirm to save.', true);

    // If final and auto-save is enabled (optional), schedule auto confirm
    const autoSaveCheckbox = document.getElementById('voice-auto-save-toggle');
    clearTimeout(autoSaveTimer);
    if (isFinal && autoSaveCheckbox?.checked) {
      updateVoiceStatus('Saving automatically in 2 seconds...', true);
      autoSaveTimer = setTimeout(async () => {
        await saveActiveParsedTransaction();
      }, 2000);
    }
  } else {
    if (confirmBtn) confirmBtn.disabled = true;
    updateVoiceStatus(parsed.error || 'Keep speaking (e.g., "300 for shopping")', true);
  }
}

// Render the interactive card previewing the extracted transaction
function renderParsedPreview(tx) {
  const previewAmount = document.getElementById('preview-tx-amount');
  const previewMerchant = document.getElementById('preview-tx-merchant');
  const previewCategory = document.getElementById('preview-tx-category');
  const previewType = document.getElementById('preview-tx-type');
  const previewDate = document.getElementById('preview-tx-date');

  const absAmt = Math.abs(tx.amount);
  const formatted = formatINR(absAmt);

  if (previewAmount) {
    previewAmount.textContent = formatted;
    previewAmount.style.color = tx.type === 'income' ? 'var(--accent-income)' : 'var(--accent-expense)';
  }

  if (previewMerchant) previewMerchant.textContent = tx.merchant;
  if (previewCategory) previewCategory.textContent = tx.category_name;
  if (previewDate) previewDate.textContent = tx.txn_date;

  if (previewType) {
    previewType.textContent = tx.type.toUpperCase();
    previewType.className = `badge badge-${tx.type === 'income' ? 'income' : 'expense'}`;
  }
}

// Save or fill the active parsed transaction
async function saveActiveParsedTransaction() {
  if (!activeParsedResult || !activeParsedResult.ok || !activeParsedResult.transaction) {
    showToast('Please speak or type a valid transaction first.', { type: 'error' });
    return;
  }

  const tx = activeParsedResult.transaction;

  // If user opened voice from inside the traditional Add modal
  if (isFillFormOnly) {
    fillTraditionalModalForm(tx);
    closeVoiceModal();
    showToast(`Autofilled form for ${tx.merchant} (${formatINR(Math.abs(tx.amount))})!`);
    return;
  }

  const newTxn = {
    txn_date: tx.txn_date,
    merchant: tx.merchant,
    description: tx.description || `${tx.merchant} (${tx.category_name})`,
    amount: tx.amount,
    category_name: tx.category_name
  };

  const saved = await api.addTransaction(newTxn);
  closeVoiceModal();

  const formattedAmt = formatINR(Math.abs(tx.amount));
  const spokenConfirmation = tx.type === 'income' 
    ? `Recorded income of ${formattedAmt} from ${tx.merchant}.`
    : `Added ${formattedAmt} for ${tx.merchant} under ${tx.category_name}.`;

  showToast(`✓ Added ${tx.merchant} (${formattedAmt})!`);
  speakText(spokenConfirmation);

  // Trigger UI re-render on active views
  if (typeof window.renderAllViews === 'function') {
    window.renderAllViews();
  }
}

// Fill fields of the traditional modal form
function fillTraditionalModalForm(tx) {
  const dateInput = document.getElementById('add-tx-date');
  const typeInput = document.getElementById('add-tx-type');
  const merchantInput = document.getElementById('add-tx-merchant');
  const descInput = document.getElementById('add-tx-desc');
  const amountInput = document.getElementById('add-tx-amount');
  const catInput = document.getElementById('add-tx-category');

  if (dateInput) dateInput.value = tx.txn_date;
  if (typeInput) typeInput.value = tx.type;
  if (merchantInput) merchantInput.value = tx.merchant;
  if (descInput) descInput.value = tx.description || tx.merchant;
  if (amountInput) amountInput.value = Math.abs(tx.amount);
  if (catInput) {
    // Select matched category if available
    const opt = Array.from(catInput.options).find(o => o.value.toLowerCase() === tx.category_name.toLowerCase());
    if (opt) catInput.value = opt.value;
  }
}

// Update Mic visual animation states
function updateMicVisuals(active) {
  const micBtn = document.getElementById('btn-voice-record-toggle');
  const pulseRing = document.getElementById('voice-pulse-ring');
  if (micBtn) {
    if (active) {
      micBtn.classList.add('recording');
      micBtn.style.background = 'var(--accent-expense)';
      micBtn.style.boxShadow = '0 0 0 10px rgba(239, 68, 68, 0.2), 0 0 0 20px rgba(239, 68, 68, 0.1)';
    } else {
      micBtn.classList.remove('recording');
      micBtn.style.background = 'var(--accent-primary)';
      micBtn.style.boxShadow = 'none';
    }
  }
  if (pulseRing) {
    pulseRing.style.display = active ? 'block' : 'none';
  }
}

// Update Voice Status text
function updateVoiceStatus(msg, isPositive) {
  const statusEl = document.getElementById('voice-status-msg');
  if (statusEl) {
    statusEl.textContent = msg;
    statusEl.style.color = isPositive ? 'var(--text-secondary)' : 'var(--accent-expense)';
  }
}

// Chat Mic Dictation for Munim Copilot
let chatRecognition = null;
let isChatListening = false;

function toggleChatMic() {
  if (!isSpeechSupported()) {
    showToast('Speech recognition not supported in your browser.', { type: 'error' });
    return;
  }

  const chatInput = document.getElementById('chat-input');
  const btnChatMic = document.getElementById('btn-chat-mic');

  if (isChatListening) {
    if (chatRecognition) chatRecognition.stop();
    isChatListening = false;
    btnChatMic?.classList.remove('active-listening');
    return;
  }

  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  chatRecognition = new SpeechRec();
  chatRecognition.continuous = false;
  chatRecognition.interimResults = true;
  chatRecognition.lang = currentLanguage;

  chatRecognition.onstart = () => {
    isChatListening = true;
    btnChatMic?.classList.add('active-listening');
    if (chatInput) chatInput.placeholder = 'Listening... Speak your question...';
  };

  chatRecognition.onresult = (e) => {
    let transcript = '';
    for (let i = e.resultIndex; i < e.results.length; ++i) {
      transcript += e.results[i][0].transcript;
    }
    if (chatInput) chatInput.value = transcript;
  };

  chatRecognition.onend = () => {
    isChatListening = false;
    btnChatMic?.classList.remove('active-listening');
    if (chatInput) chatInput.placeholder = 'Ask about your finances...';
  };

  chatRecognition.onerror = (err) => {
    console.warn('[Voice Chat] Error:', err);
    isChatListening = false;
    btnChatMic?.classList.remove('active-listening');
    if (chatInput) chatInput.placeholder = 'Ask about your finances...';
  };

  try {
    chatRecognition.start();
  } catch (e) {
    console.warn(e);
  }
}
