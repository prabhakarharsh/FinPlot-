// shared/nlp_transaction_parser.js
// Natural Language & Voice Speech-to-Transaction Parser for FinPilot
// Parses spoken or typed phrases (English, Hindi, Hinglish) into structured transactions.

import { DEFAULT_CATEGORIES, KEYWORD_RULES } from './constants.js';
import { categorise } from './engine.js';

// Number words map for spoken numbers
const NUMBER_WORDS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
  eighty: 80, ninety: 90, hundred: 100, thousand: 1000,
  lakh: 100000, lac: 100000, crore: 10000000,
  // Hindi / Hinglish number words
  ek: 1, do: 2, teen: 3, chaar: 4, char: 4, paanch: 5, panch: 5,
  chhe: 6, saat: 7, aath: 8, nau: 9, dus: 10,
  sau: 100, hazaar: 1000, hazar: 1000
};

/**
 * Convert a spoken number phrase into a numeric value.
 * e.g. "three hundred" -> 300, "two thousand five hundred" -> 2500, "5k" -> 5000, "1.5 lakh" -> 150000
 */
export function parseSpokenAmount(text) {
  if (!text) return null;
  const raw = text.toLowerCase().trim();

  // 1. Direct digit with multiplier suffix: 50k, 2.5k, 1 lakh, 2.5 lakh, 5cr
  const kMatch = raw.match(/([0-9]+(?:\.[0-9]+)?)\s*k\b/i);
  if (kMatch) {
    const val = parseFloat(kMatch[1]) * 1000;
    if (!isNaN(val) && val > 0) return Math.round(val * 100) / 100;
  }

  const lakhMatch = raw.match(/([0-9]+(?:\.[0-9]+)?)\s*(?:lakh|lac)s?\b/i);
  if (lakhMatch) {
    const val = parseFloat(lakhMatch[1]) * 100000;
    if (!isNaN(val) && val > 0) return Math.round(val * 100) / 100;
  }

  const crMatch = raw.match(/([0-9]+(?:\.[0-9]+)?)\s*(?:cr|crore)s?\b/i);
  if (crMatch) {
    const val = parseFloat(crMatch[1]) * 10000000;
    if (!isNaN(val) && val > 0) return Math.round(val * 100) / 100;
  }

  // 2. Standard digits with ₹, Rs, INR, rupees, etc.
  // Match patterns like "₹300", "Rs. 450.50", "300 rupees", "1200.00", "50000"
  const digitRegex = /(?:₹|rs\.?|inr|rupees?|rupaye?|rupay)?\s*(\b\d+(?:,\d+)*(?:\.\d{1,2})?\b)\s*(?:rupees?|rupaye?|rupay)?/i;
  const digitMatch = raw.match(digitRegex);
  if (digitMatch && digitMatch[1]) {
    const cleanNum = digitMatch[1].replace(/,/g, '');
    const val = parseFloat(cleanNum);
    if (!isNaN(val) && val > 0) return Math.round(val * 100) / 100;
  }

  // 3. Word-based numbers: "three hundred", "two thousand", "sau", "paanch sau"
  const tokens = raw.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  let total = 0;
  let current = 0;
  let foundAny = false;

  for (const token of tokens) {
    if (NUMBER_WORDS[token] !== undefined) {
      foundAny = true;
      const n = NUMBER_WORDS[token];
      if (n === 100 || n === 1000 || n === 100000 || n === 10000000) {
        if (current === 0) current = 1;
        current *= n;
        if (n >= 1000) {
          total += current;
          current = 0;
        }
      } else {
        current += n;
      }
    }
  }
  total += current;
  if (foundAny && total > 0) {
    return total;
  }

  return null;
}

/**
 * Parse a full natural voice sentence into a structured transaction.
 * @param {string} utterance Spoken or typed string
 * @param {object} options Context options { userRules: [], defaultDate: null }
 * @returns {object} { ok: boolean, transaction: { ... }, confidence: number, raw: string, error?: string }
 */
export function parseVoiceTransaction(utterance, options = {}) {
  if (!utterance || typeof utterance !== 'string' || !utterance.trim()) {
    return {
      ok: false,
      error: 'Please speak or enter a transaction amount and description.',
      confidence: 0,
      raw: utterance || ''
    };
  }

  const raw = utterance.trim();
  let text = raw.toLowerCase();

  // Normalize common phonetic mis-transcriptions
  text = text
    .replace(/\bshoping\b/g, 'shopping')
    .replace(/\bpetrol pump\b/g, 'petrol')
    .replace(/\brupye|rupiya|rupaye|rupeez|rupes\b/g, 'rupees')
    .replace(/\binr\b/g, 'rupees')
    .replace(/\brs\.?\b/g, 'rupees');

  // 1. EXTRACT DATE
  let txnDate = new Date();
  let dateMatched = false;
  if (/\b(?:yesterday|kal)\b/i.test(text)) {
    txnDate.setDate(txnDate.getDate() - 1);
    dateMatched = true;
    text = text.replace(/\b(?:yesterday|kal)\b/gi, ' ');
  } else if (/\b(?:day before yesterday|parson|parso)\b/i.test(text)) {
    txnDate.setDate(txnDate.getDate() - 2);
    dateMatched = true;
    text = text.replace(/\b(?:day before yesterday|parson|parso)\b/gi, ' ');
  } else if (/\b(?:today|aaj)\b/i.test(text)) {
    dateMatched = true;
    text = text.replace(/\b(?:today|aaj)\b/gi, ' ');
  }
  const dateStr = options.defaultDate || txnDate.toISOString().slice(0, 10);

  // 2. EXTRACT TRANSACTION TYPE (income, expense, transfer)
  let type = 'expense';
  const isIncome = /\b(?:salary|received|got|income|credited|earned|refund|cashback|bonus|dividend|mili|aaya|inflow)\b/i.test(text);
  const isTransfer = /\b(?:transfer|transferred|moved to|sent to savings|savings account|self transfer|bheja)\b/i.test(text);

  if (isIncome) {
    type = 'income';
  } else if (isTransfer) {
    type = 'transfer';
  } else {
    type = 'expense';
  }

  // 3. EXTRACT AMOUNT
  // First attempt: match explicit amount pattern with prefix/suffix
  let amount = null;
  let amountRawSubstring = null;

  // Patterns with digits
  const digitPatterns = [
    /(?:₹|rupees?|rs)\s*([0-9]+(?:\.[0-9]+)?)\s*k\b/i,
    /([0-9]+(?:\.[0-9]+)?)\s*k\s*(?:rupees?)?\b/i,
    /([0-9]+(?:\.[0-9]+)?)\s*(?:lakh|lac)s?\b/i,
    /(?:₹|rupees?|rs)\s*(\b\d+(?:,\d+)*(?:\.\d{1,2})?\b)/i,
    /(\b\d+(?:,\d+)*(?:\.\d{1,2})?\b)\s*(?:₹|rupees?|rs)/i,
    /\b(\d+(?:,\d+)*(?:\.\d{1,2})?)\b/
  ];

  for (const pat of digitPatterns) {
    const match = text.match(pat);
    if (match) {
      amount = parseSpokenAmount(match[0]);
      if (amount && amount > 0) {
        amountRawSubstring = match[0];
        break;
      }
    }
  }

  // Fallback to spoken word amounts if no digits found
  if (!amount) {
    amount = parseSpokenAmount(text);
  }

  if (!amount || isNaN(amount) || amount <= 0) {
    return {
      ok: false,
      error: `Could not identify a valid amount in "${raw}". Try saying e.g. "300 for shopping" or "₹500 petrol".`,
      confidence: 0,
      raw
    };
  }

  // 4. EXTRACT MERCHANT & DESCRIPTION
  // Remove the amount and currency tokens from the string to isolate the merchant/purpose
  let leftover = text;
  if (amountRawSubstring) {
    leftover = leftover.replace(amountRawSubstring, ' ');
  } else {
    // Remove individual number words if word-based
    leftover = leftover.replace(/\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|lakh|lac|crore|ek|do|teen|chaar|char|paanch|panch|chhe|saat|aath|nau|dus|sau|hazaar|hazar)\b/gi, ' ');
  }

  // Clean out common filler / command words
  leftover = leftover
    .replace(/\b(?:rupees?|rupay|rupaye|rs|inr|bucks|cash)\b/gi, ' ')
    .replace(/\b(?:i|have|paid|spent|bought|buy|purchased|purchase|got|received|credited|added|add|make|create|new|transaction|record)\b/gi, ' ')
    .replace(/\b(?:for|on|at|to|from|worth|of|worth of|amount|in|into|by)\b/gi, ' ')
    .replace(/\b(?:ke liye|par|ko|ka|ki|se|me|mein|diya|kiye|kharch|kharcha)\b/gi, ' ')
    .replace(/[^a-zA-Z0-9\s&-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // If leftover is empty or trivial, check if user said "300 for shopping" or "salary 50000"
  let merchant = leftover;
  let categoryName = 'Uncategorised';

  // Check known merchants from KEYWORD_RULES in raw text first
  let detectedRuleCategory = null;
  let detectedMerchantName = null;

  for (const rule of KEYWORD_RULES) {
    if (rule.pattern.test(raw)) {
      detectedRuleCategory = rule.category;
      // Extract the matched keyword as merchant candidate if merchant is empty
      const match = raw.match(rule.pattern);
      if (match && match[0]) {
        detectedMerchantName = match[0];
      }
      break;
    }
  }

  // Check default categories by name (e.g. "shopping", "groceries", "dining", "transport", "utilities", "salary")
  for (const cat of DEFAULT_CATEGORIES) {
    const catNameLower = cat.name.toLowerCase();
    if (raw.toLowerCase().includes(catNameLower) || text.includes(catNameLower)) {
      categoryName = cat.name;
      if (!merchant) {
        merchant = cat.name;
      }
      break;
    }
  }

  if (detectedRuleCategory && categoryName === 'Uncategorised') {
    categoryName = detectedRuleCategory;
  }

  // Fallback merchant if still empty
  if (!merchant) {
    if (detectedMerchantName) {
      merchant = detectedMerchantName;
    } else if (categoryName !== 'Uncategorised') {
      merchant = categoryName;
    } else if (type === 'income') {
      merchant = 'Income Deposit';
      categoryName = 'Other Income';
    } else if (type === 'transfer') {
      merchant = 'Self Transfer';
      categoryName = 'Transfers';
    } else {
      merchant = 'General Expense';
    }
  }

  // Capitalize merchant nicely
  merchant = merchant
    .split(' ')
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

  // If category is still uncategorised, run engine's categorise
  if (categoryName === 'Uncategorised') {
    const catResult = categorise({ merchant, description: raw }, options.userRules || []);
    if (catResult && catResult.category && catResult.category !== 'Uncategorised') {
      categoryName = catResult.category;
    }
  }

  // If type is income, ensure category matches income
  if (type === 'income' && categoryName === 'Uncategorised') {
    categoryName = 'Other Income';
  } else if (type === 'transfer') {
    categoryName = 'Transfers';
  }

  // Final signed amount (negative for expense, positive for income)
  const signedAmount = type === 'expense' ? -Math.abs(amount) : Math.abs(amount);

  // Confidence calculation
  let confidence = 0.7;
  if (amount > 0) confidence += 0.15;
  if (merchant && merchant !== 'General Expense') confidence += 0.1;
  if (categoryName !== 'Uncategorised') confidence += 0.05;
  confidence = Math.min(confidence, 1.0);

  return {
    ok: true,
    confidence,
    raw,
    transaction: {
      txn_date: dateStr,
      merchant,
      description: raw,
      amount: signedAmount,
      raw_amount: Math.abs(amount),
      type,
      category_name: categoryName
    }
  };
}
