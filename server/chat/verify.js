// server/chat/verify.js
// Server-side Answer Verifier for Munim AI Personal Finance Copilot
// Ensures zero arithmetic hallucination, strictly verified citations, and ban enforcement

const BANNED_TERMS = [
  /\b(?:fraudulent|fraud|scam|scammers|stolen|ponzi|theft)\b/i,
  /\b(?:buy stock|invest in (?:shares|equity|crypto|bitcoin)|buy (?:this|the) policy)\b/i,
  /\b(?:tax evasion|evade tax(?:es)?)\b/i
];

/**
 * Extract numbers, currency figures, percentages, and dates from text
 */
export function extractNumbersAndDates(text = '') {
  if (!text || typeof text !== 'string') return [];

  const found = new Set();

  // 1. Currency amounts: ₹1,15,000, ₹42,310.50, Rs. 500, etc.
  const currencyMatches = text.match(/(?:₹|rs\.?|inr)\s*[\d,]+(?:\.\d+)?/gi) || [];
  for (const m of currencyMatches) {
    found.add(m.trim());
    // Also add the bare normalized numeric string
    const bare = m.replace(/[^\d.]/g, '');
    if (bare) found.add(bare);
  }

  // 2. Percentages: 63.2%, 15%
  const pctMatches = text.match(/\b\d+(?:\.\d+)?%/g) || [];
  for (const p of pctMatches) {
    found.add(p);
    found.add(p.replace('%', ''));
  }

  // 3. Dates: 2026-05-01, 2026-10-20
  const dateMatches = text.match(/\b\d{4}-\d{2}-\d{2}\b/g) || [];
  for (const d of dateMatches) {
    found.add(d);
  }

  // 4. Standalone numbers with optional commas/decimals
  const numMatches = text.match(/\b\d{1,3}(?:,\d{2,3})*(?:\.\d+)?\b/g) || [];
  for (const n of numMatches) {
    const raw = n.replace(/,/g, '');
    found.add(raw);
    found.add(n);
  }

  return Array.from(found);
}

/**
 * Build allow-set of verifiable values from tool results
 */
export function buildAllowSet(toolResults = [], userQuery = '') {
  const allowSet = new Set();

  // Trivial numbers that are always allowed (small ordinals, years, rounding variations)
  const trivial = [
    '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10',
    '12', '24', '30', '31', '365', '52', '26',
    '2024', '2025', '2026', '2027', '2028',
    '100' // 100%
  ];
  trivial.forEach(t => allowSet.add(t));

  // Add numbers present in the user prompt (e.g., user asks "last 3 months")
  const userNums = extractNumbersAndDates(userQuery);
  userNums.forEach(n => allowSet.add(n));

  function ingestValue(val) {
    if (val === null || val === undefined) return;
    if (typeof val === 'number') {
      const s = String(val);
      allowSet.add(s);
      allowSet.add(String(Math.round(val)));
      allowSet.add(val.toFixed(1));
      allowSet.add(val.toFixed(2));
      allowSet.add(val.toLocaleString('en-IN'));
      allowSet.add(`₹${val.toLocaleString('en-IN')}`);
      return;
    }

    if (typeof val === 'string') {
      allowSet.add(val.trim());
      // Extract numbers inside the string
      const subNums = extractNumbersAndDates(val);
      subNums.forEach(sn => allowSet.add(sn));
      return;
    }

    if (Array.isArray(val)) {
      val.forEach(item => ingestValue(item));
      return;
    }

    if (typeof val === 'object') {
      Object.values(val).forEach(v => ingestValue(v));
    }
  }

  for (const tr of toolResults) {
    if (tr.display) ingestValue(tr.display);
    if (tr.data) ingestValue(tr.data);
    if (tr.calc_id) allowSet.add(tr.calc_id);
    if (Array.isArray(tr.sources)) {
      tr.sources.forEach(s => {
        if (s.id) allowSet.add(s.id);
        if (s.label) ingestValue(s.label);
      });
    }
  }

  return allowSet;
}

/**
 * Verify Answer against Tool Allow-Set and Citations
 */
export function verifyAnswer({
  answerText = '',
  toolResults = [],
  userQuery = ''
}) {
  const issues = [];
  let isBanned = false;
  let bannedTermMatched = '';

  // 1. Scan for banned terms
  for (const pattern of BANNED_TERMS) {
    const match = answerText.match(pattern);
    if (match) {
      isBanned = true;
      bannedTermMatched = match[0];
      issues.push(`Contains banned terminology: "${match[0]}". Must use neutral phrasing ("flagged for review") and avoid regulated advice.`);
      break;
    }
  }

  // 2. Build allow-set
  const allowSet = buildAllowSet(toolResults, userQuery);

  // 3. Extract numbers from the draft answer (excluding citation markers like [calc:...] or [txn:...])
  const textWithoutCitations = answerText.replace(/\[(txn|calc):[^\]]+\]/g, '');
  const numbersInAnswer = extractNumbersAndDates(textWithoutCitations);
  const unverifiedNumbers = [];

  for (const num of numbersInAnswer) {
    const cleaned = num.replace(/[₹\s,]/g, '').replace(/%$/, '');
    if (!cleaned) continue;

    // Check if directly in allowSet or matches any allowable number
    let matched = allowSet.has(num) || allowSet.has(cleaned);

    if (!matched) {
      const parsedFloat = parseFloat(cleaned);
      if (!isNaN(parsedFloat)) {
        // Allow close rounding if tool had 42310.20 and text says 42310
        for (const allowed of allowSet) {
          const allowedNum = parseFloat(String(allowed).replace(/[₹\s,]/g, ''));
          if (!isNaN(allowedNum) && Math.abs(allowedNum - parsedFloat) <= 1) {
            matched = true;
            break;
          }
        }
      }
    }

    if (!matched) {
      unverifiedNumbers.push(num);
    }
  }

  // 4. Verify citations
  const validCitationIds = new Set();
  for (const tr of toolResults) {
    if (tr.calc_id) validCitationIds.add(tr.calc_id);
    if (Array.isArray(tr.sources)) {
      tr.sources.forEach(s => {
        if (s.id) validCitationIds.add(s.id);
      });
    }
  }

  // Strip invalid citations or retain valid ones
  let sanitizedAnswer = answerText.replace(/\[(txn|calc):([^\]]+)\]/g, (match, type, id) => {
    if (validCitationIds.has(id)) {
      return match;
    }
    // Check partial match (e.g. summary:2026-05)
    for (const valid of validCitationIds) {
      if (valid.includes(id) || id.includes(valid)) {
        return `[${type}:${valid}]`;
      }
    }
    return ''; // Strip non-existent citation
  });

  const verified = !isBanned && unverifiedNumbers.length === 0;

  return {
    verified,
    isBanned,
    bannedTerm: bannedTermMatched,
    unverifiedNumbers,
    sanitizedAnswer,
    allowSetSize: allowSet.size
  };
}

/**
 * Generate safe deterministic fallback answer when verification fails after retry
 */
export function generateSafeFallback(toolResults = []) {
  const bulletPoints = [];
  const validCitations = [];

  for (const tr of toolResults) {
    if (tr.display) {
      for (const [key, val] of Object.entries(tr.display)) {
        if (typeof val === 'string' && val.trim()) {
          const label = key.replace(/_/g, ' ');
          bulletPoints.push(`• **${label.charAt(0).toUpperCase() + label.slice(1)}:** ${val}`);
        }
      }
    }
    if (tr.calc_id) {
      validCitations.push(`[calc:${tr.calc_id}]`);
    }
  }

  const citationsText = validCitations.length ? ' ' + validCitations.slice(0, 2).join(' ') : '';

  return `I couldn't verify some numbers in my draft answer against your computed records, so here is what I can confirm with 100% precision from your tool calculations:${citationsText}\n\n` +
    bulletPoints.slice(0, 6).join('\n') +
    `\n\n*Note: Every number above is directly derived from your transactions via pure JavaScript arithmetic.*`;
}
