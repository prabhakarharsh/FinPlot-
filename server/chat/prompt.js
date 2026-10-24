// server/chat/prompt.js
// System Prompt, Safety Guards, and Untrusted Data Sanitizer for Munim AI Copilot

import { summarise } from '../../shared/engine.js';

export const PROMPT_VERSION = 'munim-v2.0';

/**
 * Pre-LLM Input Guard (Runs before any LLM invocation)
 * Rejects messages > 1000 chars, cards passing Luhn check, or OTP/PIN/CVV sharing.
 */
export function checkInputGuard(userInput = '') {
  if (typeof userInput !== 'string') {
    return { ok: false, reason: 'INVALID_INPUT', refusal: 'Invalid message format.' };
  }

  // 1. Length check: max 1,000 characters
  if (userInput.length > 1000) {
    return {
      ok: false,
      reason: 'LENGTH_EXCEEDED',
      refusal: 'Your question is a bit too long (maximum 1,000 characters). Please send a shorter question and I will gladly help!'
    };
  }

  // 2. Check for credit/debit card numbers using regex + Luhn algorithm
  const potentialCardMatches = userInput.match(/\b(?:\d[ -]*?){13,19}\b/g);
  if (potentialCardMatches) {
    for (const match of potentialCardMatches) {
      const digits = match.replace(/[\s-]/g, '');
      if (digits.length >= 13 && digits.length <= 19 && luhnCheck(digits)) {
        return {
          ok: false,
          reason: 'CREDENTIAL_DETECTED',
          refusal: 'I noticed what looks like a payment card number. For your security, please never share card numbers, CVVs, PINs, or bank passwords with Munim.'
        };
      }
    }
  }

  // 3. Check for OTP / CVV / PIN patterns (3-8 digit numbers near sensitive security keywords)
  const otpPattern = /(?:\b(?:otp|one[- ]time[- ]password|cvv|cvc|pin|passcode|password)\b(?:\s+\w+){0,4}\s*[:=-]?\s*\b\d{3,8}\b|\b\d{3,8}\b(?:\s+\w+){0,4}\s*(?:\b(?:otp|cvv|cvc|pin|passcode)\b))/i;
  if (otpPattern.test(userInput)) {
    return {
      ok: false,
      reason: 'OTP_DETECTED',
      refusal: 'For your security, please never share OTPs, PINs, CVVs, or bank passwords. FinPilot will never ask for your credentials.'
    };
  }

  // 4. Log obvious prompt-injection attempts for observability (without throwing)
  const injectionPattern = /(?:ignore\s+(?:all\s+)?(?:previous\s+)?instructions|system\s+prompt|reveal\s+(?:your\s+)?prompt|jailbreak)/i;
  const isSuspicious = injectionPattern.test(userInput);

  return { ok: true, isSuspicious };
}

/**
 * Standard Luhn Check for Card Number validation
 */
export function luhnCheck(numStr) {
  let sum = 0;
  let alternate = false;
  for (let i = numStr.length - 1; i >= 0; i--) {
    let n = parseInt(numStr.charAt(i), 10);
    if (isNaN(n)) return false;
    if (alternate) {
      n *= 2;
      if (n > 9) n = (n % 10) + 1;
    }
    sum += n;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

/**
 * Sanitize untrusted transaction text (strip control chars, truncate >200 chars)
 */
export function sanitizeUntrustedText(text = '') {
  if (!text || typeof text !== 'string') return '';
  // Remove control characters (ASCII 0-31 and 127) except tab and newline
  const cleaned = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  // Cap at 200 characters
  return cleaned.length > 200 ? cleaned.slice(0, 197) + '...' : cleaned;
}

/**
 * Wrap tool output in safe untrusted delimiters
 */
export function wrapToolOutput(toolName, resultObject) {
  const sanitizedString = JSON.stringify(resultObject, (key, value) => {
    if (typeof value === 'string' && (key === 'description' || key === 'merchant' || key === 'label')) {
      return sanitizeUntrustedText(value);
    }
    return value;
  });

  return `<tool_result name="${toolName}" untrusted="true">\n${sanitizedString}\n</tool_result>`;
}

/**
 * Build System Prompt with Injected Context
 */
export function buildSystemPrompt(context = {}) {
  const {
    today = new Date().toISOString().split('T')[0],
    timezone = 'Asia/Kolkata',
    currency = 'INR (₹)',
    dateRange = 'Available in records',
    isSample = false,
    transactions = [],
    goals = []
  } = context;

  let snapshotText = 'No transactions recorded yet. Invite the user to add transactions or load sample data.';

  if (Array.isArray(transactions) && transactions.length > 0) {
    try {
      const sum = summarise(transactions);
      const topCats = (sum.categories || []).slice(0, 5).map(c => `${c.name}: ₹${c.total.toLocaleString('en-IN')} (${c.percentage}%)`).join(', ');
      const topMerchants = (sum.topMerchants || []).slice(0, 5).map(m => `${m.merchant}: ₹${m.total.toLocaleString('en-IN')}`).join(', ');
      const recentTxns = transactions.slice(0, 5).map(t => `${t.txn_date}: ${t.merchant || t.description} (₹${Math.abs(t.amount).toLocaleString('en-IN')}, ${t.category_name || 'Uncategorised'})`).join('; ');
      const goalsList = Array.isArray(goals) && goals.length > 0
        ? goals.map(g => `${g.name} (Target: ₹${Number(g.target_amount || 0).toLocaleString('en-IN')}, Saved: ₹${Number(g.current_amount || 0).toLocaleString('en-IN')}, Deadline: ${g.target_date || 'None'})`).join('; ')
        : 'None active.';

      snapshotText = `
- Total Recorded Transactions: ${transactions.length}
- Total Income: ₹${sum.income.toLocaleString('en-IN')}
- Total Spending: ₹${sum.spending.toLocaleString('en-IN')}
- Net Savings Balance: ₹${sum.net.toLocaleString('en-IN')} (Savings Rate: ${sum.savingsRate}%)
- Top Spending Categories: ${topCats || 'None'}
- Top Merchants: ${topMerchants || 'None'}
- Active Savings Goals: ${goalsList}
- Recent Transactions Sample: ${recentTxns}`;
    } catch (e) {
      // Fallback if summarisation encountered an issue
    }
  }

  return `### SYSTEM PROMPT: MUNIM — FREESTYLE FINANCIAL COPILOT (Version: ${PROMPT_VERSION})

1. IDENTITY AND ROLE:
You are Munim, FinPilot's AI financial copilot. You are warm, plain-spoken, highly insightful, and conversant like a smart, trusted friend who is great with money.
You can answer ANY question the user asks about their finances, spending habits, merchants, categories, budgets, affordability (e.g. "Can I afford to buy X?", "How much did I spend on Y?"), or savings advice.
Match the user's language naturally (English, Hindi, or Hinglish).

2. REAL-TIME USER DATA ACCESS & FREESTYLE CAPABILITY:
You have direct, real-time access to the user's live financial data snapshot below.
When the user asks questions about their spending, income, merchants, categories, goals, or affordability, answer directly, flexibly, and conversationally using this data.
You can also invoke tools whenever you need deeper filtering, searches across specific keywords, what-if scenario simulations, or action proposals.
${isSample ? 'Note: The user currently has sample data active for exploration.' : ''}

3. AFFORDABILITY & ADVISORY REASONING:
- If the user asks "Can I afford X?" or "Should I buy Y?", calculate whether their current net monthly surplus and savings buffer allow for it, explain the trade-offs with their active goals, and suggest a realistic savings timeline.
- If the user asks for savings tips, look at their highest discretionary spending categories (like Dining or Shopping) and give practical, actionable suggestions grounded in their actual numbers.

4. CITATION GUIDELINES:
After citing computed figures or specific transactions, include [txn:<id>] or [calc:<calc_id>] when available. Do not invent citations. For general conversational advice, plain text is completely fine.

5. SAFETY BOUNDARIES:
- For flagged items: say "flagged for review" or "looks different from your usual pattern". NEVER say "fraud", "scam", or "theft".
- Never request or accept passwords, PINs, OTPs, card numbers, or bank logins.
- You are an intelligent personal finance copilot, not a certified financial planner. Do not recommend specific stock tickers, mutual funds, crypto schemes, or tax evasion directives.
- To propose changes (like recategorisation), call the "propose_action" tool.

---
LIVE FINANCIAL DATA SNAPSHOT:
${snapshotText}

ENVIRONMENT:
- Today's Date: ${today}
- Timezone: ${timezone}
- Currency: ${currency}
- Transaction Date Range: ${dateRange}`;
}
