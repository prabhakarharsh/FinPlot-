// shared/engine.js
// Pure, deterministic financial engine for FinPilot (shared between browser and server)
// All arithmetic uses integer cents to eliminate floating-point precision issues.

import { KEYWORD_RULES, ANOMALY_CODES } from './constants.js';

/**
 * Convert floating-point currency to integer cents.
 */
export function toCents(amount) {
  if (amount === null || amount === undefined || isNaN(amount)) return 0;
  return Math.round(Number(amount) * 100);
}

/**
 * Convert integer cents back to standard decimal currency.
 */
export function fromCents(cents) {
  return Number((cents / 100).toFixed(2));
}

/**
 * Format currency in Indian Rupees (₹) with en-IN formatting.
 */
export function formatCurrency(amount, currency = 'INR') {
  const num = typeof amount === 'number' ? amount : Number(amount) || 0;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: currency,
    maximumFractionDigits: 2,
    minimumFractionDigits: 2
  }).format(num);
}

/**
 * Robust pure JavaScript CSV parser with quotes handling (zero external dependency).
 */
export function parseCSV(text) {
  if (!text || typeof text !== 'string') return { headers: [], rows: [] };
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };

  function parseLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  }

  const rawHeaders = parseLine(lines[0]);
  const headers = rawHeaders.map(h => h.replace(/^["']|["']$/g, '').trim());
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const vals = parseLine(lines[i]);
    if (vals.length === headers.length || vals.some(v => v.length > 0)) {
      const rowObj = {};
      headers.forEach((h, idx) => {
        const rawVal = vals[idx] !== undefined ? vals[idx].replace(/^["']|["']$/g, '').trim() : '';
        const num = Number(rawVal);
        rowObj[h] = !isNaN(num) && rawVal !== '' ? num : rawVal;
      });
      rows.push(rowObj);
    }
  }

  return { headers, rows };
}

/**
 * Normalise merchant name for clustering and recurring analysis.
 */
export function normaliseMerchant(name) {
  if (!name || typeof name !== 'string') return 'Unknown';
  return name
    .toLowerCase()
    .replace(/[0-9]+/g, '') // remove numbers/IDs
    .replace(/[*:\;.,\/\#\-_~]/g, ' ') // replace punctuation with spaces
    .replace(/\b(ref|txn|pos|upi|neft|imps|card|xx+|com|in|org|net|ltd|pvt)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, c => c.toUpperCase()); // Title Case
}

/**
 * Categorise a single transaction based on user learned rules and keyword patterns.
 * Priority: 1. User Rules -> 2. Keyword Rules in constants.js -> 3. "Uncategorised"
 */
export function categorise(txn, userRules = []) {
  const desc = (txn.description || '').toLowerCase();
  const merch = (txn.merchant || '').toLowerCase();
  const target = `${merch} ${desc}`.trim();

  // 1. User-defined learned rules
  if (Array.isArray(userRules)) {
    for (const rule of userRules) {
      const pattern = (rule.merchant_pattern || rule.pattern || '').toLowerCase().trim();
      if (pattern && target.includes(pattern)) {
        return {
          category: rule.category_name || rule.category || 'Uncategorised',
          source: 'user',
          matchedRule: `User rule: "${pattern}"`
        };
      }
    }
  }

  // 2. Keyword rules from constants.js
  for (const rule of KEYWORD_RULES) {
    if (rule.pattern.test(target)) {
      return {
        category: rule.category,
        source: 'auto',
        matchedRule: `Keyword rule: ${rule.pattern.toString()}`
      };
    }
  }

  // 3. Fallback
  return {
    category: 'Uncategorised',
    source: 'auto',
    matchedRule: 'None (default)'
  };
}

/**
 * Summarise transactions for a given date range.
 * Computes income, spending, net, savings rate, category breakdowns, top merchants, and monthly series.
 */
export function summarise(txns = [], filter = {}) {
  const fromDate = filter.from ? new Date(filter.from) : null;
  const toDate = filter.to ? new Date(filter.to) : null;

  // Filter transactions
  const filtered = txns.filter(t => {
    if (!t.txn_date) return false;
    const d = new Date(t.txn_date);
    if (fromDate && d < fromDate) return false;
    if (toDate && d > toDate) return false;
    return true;
  });

  let incomeCents = 0;
  let spendingCents = 0;
  let transferCents = 0;

  const categoryMap = new Map();
  const merchantMap = new Map();
  const monthlyMap = new Map();
  const usedTxnIds = [];

  for (const t of filtered) {
    usedTxnIds.push(t.id);
    const amountCents = toCents(t.amount);
    const categoryName = t.category_name || t.category || 'Uncategorised';
    const isTransfer = categoryName.toLowerCase() === 'transfers';

    if (isTransfer) {
      transferCents += Math.abs(amountCents);
      continue;
    }

    if (amountCents > 0) {
      incomeCents += amountCents;
    } else if (amountCents < 0) {
      const outflow = Math.abs(amountCents);
      spendingCents += outflow;

      // Category breakdown (for outflows)
      const catObj = categoryMap.get(categoryName) || { name: categoryName, totalCents: 0, count: 0 };
      catObj.totalCents += outflow;
      catObj.count += 1;
      categoryMap.set(categoryName, catObj);

      // Merchant breakdown
      const mName = t.merchant || normaliseMerchant(t.description) || 'Other';
      const merchObj = merchantMap.get(mName) || { merchant: mName, totalCents: 0, count: 0 };
      merchObj.totalCents += outflow;
      merchObj.count += 1;
      merchantMap.set(mName, merchObj);
    }

    // Monthly bucket
    const dateStr = String(t.txn_date).slice(0, 7); // 'YYYY-MM'
    if (dateStr && dateStr.length === 7) {
      const monthObj = monthlyMap.get(dateStr) || { month: dateStr, incomeCents: 0, spendingCents: 0, count: 0 };
      if (!isTransfer) {
        if (amountCents > 0) monthObj.incomeCents += amountCents;
        else if (amountCents < 0) monthObj.spendingCents += Math.abs(amountCents);
      }
      monthObj.count += 1;
      monthlyMap.set(dateStr, monthObj);
    }
  }

  const netCents = incomeCents - spendingCents;
  const savingsRate = incomeCents > 0
    ? Number(((netCents / incomeCents) * 100).toFixed(1))
    : 0;

  // Format category list
  const categories = Array.from(categoryMap.values())
    .map(c => ({
      name: c.name,
      total: fromCents(c.totalCents),
      count: c.count,
      percentage: spendingCents > 0 ? Number(((c.totalCents / spendingCents) * 100).toFixed(1)) : 0
    }))
    .sort((a, b) => b.total - a.total);

  // Format top merchants
  const topMerchants = Array.from(merchantMap.values())
    .map(m => ({
      merchant: m.merchant,
      total: fromCents(m.totalCents),
      count: m.count
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);

  // Format monthly series
  const monthly = Array.from(monthlyMap.values())
    .sort((a, b) => a.month.localeCompare(b.month))
    .map(m => {
      const mNetCents = m.incomeCents - m.spendingCents;
      return {
        month: m.month,
        income: fromCents(m.incomeCents),
        spending: fromCents(m.spendingCents),
        net: fromCents(mNetCents),
        savingsRate: m.incomeCents > 0 ? Number(((mNetCents / m.incomeCents) * 100).toFixed(1)) : 0,
        count: m.count
      };
    });

  return {
    income: fromCents(incomeCents),
    spending: fromCents(spendingCents),
    net: fromCents(netCents),
    savingsRate,
    transferTotal: fromCents(transferCents),
    transactionCount: filtered.length,
    categories,
    topMerchants,
    monthly,
    txn_ids: usedTxnIds,
    calculation: {
      formula: 'Net = Income - Spending; SavingsRate = (Net / Income) * 100',
      incomeCents,
      spendingCents,
      netCents
    }
  };
}

/**
 * Detect recurring payments and subscriptions.
 * Criteria: >= 3 transactions, regular day intervals (7, 14, 30, 365 ± 3-5 days), amount variance <= 10%.
 */
export function detectRecurring(txns = []) {
  // Only look at expense transactions
  const expenses = txns.filter(t => toCents(t.amount) < 0);
  const groups = new Map();

  for (const t of expenses) {
    const norm = normaliseMerchant(t.merchant || t.description);
    if (!norm || norm.length < 2) continue;
    if (!groups.has(norm)) {
      groups.set(norm, []);
    }
    groups.get(norm).push(t);
  }

  const results = [];

  for (const [merchant, groupTxns] of groups.entries()) {
    if (groupTxns.length < 3) continue;

    // Sort by date ascending
    const sorted = [...groupTxns].sort((a, b) => new Date(a.txn_date) - new Date(b.txn_date));

    // Calculate intervals between consecutive transactions
    const intervals = [];
    for (let i = 1; i < sorted.length; i++) {
      const d1 = new Date(sorted[i - 1].txn_date);
      const d2 = new Date(sorted[i].txn_date);
      const diffDays = Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
      intervals.push(diffDays);
    }

    if (intervals.length < 2) continue;

    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;

    // Check cadence match
    let frequency = null;
    let expectedDays = 0;
    if (Math.abs(avgInterval - 7) <= 3) {
      frequency = 'weekly';
      expectedDays = 7;
    } else if (Math.abs(avgInterval - 14) <= 4) {
      frequency = 'bi-weekly';
      expectedDays = 14;
    } else if (Math.abs(avgInterval - 30.5) <= 5) {
      frequency = 'monthly';
      expectedDays = 30;
    } else if (Math.abs(avgInterval - 365) <= 15) {
      frequency = 'yearly';
      expectedDays = 365;
    }

    if (!frequency) continue;

    // Check amount variance: within +/- 15%
    const amountsCents = sorted.map(t => Math.abs(toCents(t.amount)));
    const avgAmountCents = Math.round(amountsCents.reduce((a, b) => a + b, 0) / amountsCents.length);
    const minAmount = Math.min(...amountsCents);
    const maxAmount = Math.max(...amountsCents);
    const spread = (maxAmount - minAmount) / avgAmountCents;

    if (spread > 0.25) continue; // High variance in amount, skip

    // Confidence calculation (0 to 1)
    const intervalVariance = intervals.reduce((sum, int) => sum + Math.abs(int - expectedDays), 0) / intervals.length;
    const intervalScore = Math.max(0, 1 - (intervalVariance / 10));
    const amountScore = Math.max(0, 1 - spread);
    const countScore = Math.min(1, sorted.length / 5);
    const confidence = Number(((intervalScore * 0.45 + amountScore * 0.35 + countScore * 0.20)).toFixed(2));

    // Next expected date
    const lastDate = new Date(sorted[sorted.length - 1].txn_date);
    const nextExpected = new Date(lastDate);
    nextExpected.setDate(nextExpected.getDate() + Math.round(expectedDays));

    results.push({
      merchant,
      avg_amount: fromCents(avgAmountCents),
      frequency,
      next_expected: nextExpected.toISOString().slice(0, 10),
      confidence,
      count: sorted.length,
      txn_ids: sorted.map(t => t.id),
      supporting_dates: sorted.map(t => t.txn_date)
    });
  }

  return results.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Flag unusual transactions for user review.
 * Strictly uses neutral wording and reason codes. Never uses words like "fraud" or "suspicious".
 */
export function flagAnomalies(txns = []) {
  if (!Array.isArray(txns) || txns.length === 0) return [];

  const flags = [];
  const expenses = txns.filter(t => toCents(t.amount) < 0);

  // Helper: category grouping
  const categoryGroups = new Map();
  // Helper: merchant history
  const merchantHistory = new Map();

  for (const t of expenses) {
    const cat = t.category_name || t.category || 'Uncategorised';
    if (!categoryGroups.has(cat)) categoryGroups.set(cat, []);
    categoryGroups.get(cat).push(t);

    const merch = normaliseMerchant(t.merchant || t.description);
    if (!merchantHistory.has(merch)) merchantHistory.set(merch, []);
    merchantHistory.get(merch).push(t);
  }

  // 1. Median transaction amount across all expenses
  const allAmounts = expenses.map(t => Math.abs(toCents(t.amount))).sort((a, b) => a - b);
  const medianCents = allAmounts.length > 0
    ? allAmounts[Math.floor(allAmounts.length / 2)]
    : 0;

  // Rule A: Category Outlier (> Mean + 3 * StdDev for categories with >= 5 txns)
  for (const [catName, list] of categoryGroups.entries()) {
    if (list.length < 5) continue;
    const centsList = list.map(t => Math.abs(toCents(t.amount)));
    const mean = centsList.reduce((a, b) => a + b, 0) / centsList.length;
    const variance = centsList.reduce((sum, c) => sum + Math.pow(c - mean, 2), 0) / centsList.length;
    const stdDev = Math.sqrt(variance);

    const threshold = mean + 3 * stdDev;

    for (const t of list) {
      const val = Math.abs(toCents(t.amount));
      if (val > threshold && val > 200000) { // at least ₹2,000 and 3 std
        flags.push({
          txn_id: t.id,
          reason_code: ANOMALY_CODES.UNUSUAL_AMOUNT,
          reason_text: `Amount ${formatCurrency(fromCents(val))} is significantly higher than your typical ${catName} spending (average: ${formatCurrency(fromCents(mean))}).`,
          score: Number((val / (mean || 1)).toFixed(1)),
          details: {
            mean: fromCents(mean),
            stdDev: fromCents(stdDev),
            threshold: fromCents(threshold)
          }
        });
      }
    }
  }

  // Rule B: First-time merchant with amount > 2 * user median txn (and > ₹3,000)
  for (const [merchName, list] of merchantHistory.entries()) {
    if (list.length === 1 && medianCents > 0) {
      const singleTxn = list[0];
      const val = Math.abs(toCents(singleTxn.amount));
      if (val > 2 * medianCents && val > 300000) { // ₹3,000 min
        flags.push({
          txn_id: singleTxn.id,
          reason_code: ANOMALY_CODES.NEW_LARGE_MERCHANT,
          reason_text: `First transaction with ${merchName} and the amount (${formatCurrency(fromCents(val))}) is more than double your typical median expense (${formatCurrency(fromCents(medianCents))}).`,
          score: Number((val / (medianCents || 1)).toFixed(1)),
          details: {
            merchant: merchName,
            userMedian: fromCents(medianCents),
            amount: fromCents(val)
          }
        });
      }
    }
  }

  // Rule C: Possible Duplicate (same merchant + same exact amount twice within 48 hours)
  const sortedExpenses = [...expenses].sort((a, b) => new Date(a.txn_date) - new Date(b.txn_date));
  for (let i = 0; i < sortedExpenses.length - 1; i++) {
    for (let j = i + 1; j < sortedExpenses.length; j++) {
      const t1 = sortedExpenses[i];
      const t2 = sortedExpenses[j];

      const d1 = new Date(t1.txn_date);
      const d2 = new Date(t2.txn_date);
      const hoursDiff = (d2 - d1) / (1000 * 60 * 60);

      if (hoursDiff > 48) break; // exceeded time window

      const m1 = normaliseMerchant(t1.merchant || t1.description);
      const m2 = normaliseMerchant(t2.merchant || t2.description);
      const amt1 = Math.abs(toCents(t1.amount));
      const amt2 = Math.abs(toCents(t2.amount));

      if (m1 === m2 && amt1 === amt2 && t1.id !== t2.id) {
        flags.push({
          txn_id: t2.id,
          reason_code: ANOMALY_CODES.POSSIBLE_DUPLICATE,
          reason_text: `Identical charge of ${formatCurrency(fromCents(amt2))} at ${m1} occurred within 48 hours of another transaction on ${t1.txn_date}.`,
          score: 1.0,
          details: {
            twin_txn_id: t1.id,
            first_date: t1.txn_date,
            second_date: t2.txn_date,
            merchant: m1,
            amount: fromCents(amt2)
          }
        });
      }
    }
  }

  // Rule D: Price increase on recurring payments
  const recurringList = detectRecurring(txns);
  for (const rec of recurringList) {
    if (!rec.txn_ids || rec.txn_ids.length < 2) continue;
    const recTxns = expenses
      .filter(t => rec.txn_ids.includes(t.id))
      .sort((a, b) => new Date(a.txn_date) - new Date(b.txn_date));

    if (recTxns.length >= 2) {
      const prev = recTxns[recTxns.length - 2];
      const curr = recTxns[recTxns.length - 1];
      const prevCents = Math.abs(toCents(prev.amount));
      const currCents = Math.abs(toCents(curr.amount));

      if (prevCents > 0 && currCents > prevCents) {
        const increaseRatio = (currCents - prevCents) / prevCents;
        if (increaseRatio >= 0.15) { // 15% or more
          flags.push({
            txn_id: curr.id,
            reason_code: ANOMALY_CODES.PRICE_CHANGE,
            reason_text: `Recurring payment for ${rec.merchant} increased by ${Math.round(increaseRatio * 100)}% (from ${formatCurrency(fromCents(prevCents))} to ${formatCurrency(fromCents(currCents))}).`,
            score: Number((increaseRatio * 10).toFixed(1)),
            details: {
              merchant: rec.merchant,
              previousAmount: fromCents(prevCents),
              currentAmount: fromCents(currCents),
              percentIncrease: Math.round(increaseRatio * 100)
            }
          });
        }
      }
    }
  }

  // Deduplicate flags by txn_id + reason_code
  const seen = new Set();
  const uniqueFlags = [];
  for (const f of flags) {
    const key = `${f.txn_id}_${f.reason_code}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueFlags.push(f);
    }
  }

  return uniqueFlags;
}

/**
 * Run cash-flow and savings goal what-if scenario.
 * Returns monthly surplus, months to goal, projected completion date, month-by-month projection, and explicit assumptions.
 */
export function runScenario(params = {}) {
  const currentSavings = Math.max(0, toCents(params.currentSavings || 0));
  const goalTarget = Math.max(0, toCents(params.goal || params.target_amount || 0));
  const monthlyIncome = Math.max(0, toCents(params.monthlyIncome || 0));
  const monthlyExpenses = Math.max(0, toCents(params.monthlyExpenses || 0));

  // Category reductions (object of { categoryName: percentOrCentsCut })
  const cutByCategory = params.cutByCategory || {};
  let totalCutsCents = 0;
  const cutBreakdown = [];

  for (const [cat, cutVal] of Object.entries(cutByCategory)) {
    const cutCents = toCents(cutVal);
    if (cutCents > 0) {
      totalCutsCents += cutCents;
      cutBreakdown.push({ category: cat, cutAmount: fromCents(cutCents) });
    }
  }

  const extraMonthlyIncome = Math.max(0, toCents(params.extraMonthlyIncome || 0));
  const oneOffExpense = Math.max(0, toCents(params.oneOffExpense || 0));
  const annualInterestRate = Math.max(0, Number(params.annualInterestRate || 0)); // e.g. 5 for 5%
  const monthlyRate = (annualInterestRate / 100) / 12;

  // Starting balance after immediate one-off expense
  let balanceCents = Math.max(0, currentSavings - oneOffExpense);

  // Effective monthly savings
  const baselineMonthlySurplusCents = monthlyIncome - monthlyExpenses;
  const newMonthlySavingsCents = baselineMonthlySurplusCents + totalCutsCents + extraMonthlyIncome;

  const remainingGoalCents = Math.max(0, goalTarget - balanceCents);

  let monthsToGoal = 0;
  let attainable = true;

  if (remainingGoalCents === 0) {
    monthsToGoal = 0;
  } else if (newMonthlySavingsCents <= 0 && balanceCents < goalTarget) {
    attainable = false;
    monthsToGoal = Infinity;
  } else {
    // Project month by month (up to 360 months = 30 years)
    let currentBal = balanceCents;
    let m = 0;
    while (currentBal < goalTarget && m < 360) {
      m++;
      const interestCents = Math.round(currentBal * monthlyRate);
      currentBal += newMonthlySavingsCents + interestCents;
    }
    monthsToGoal = currentBal >= goalTarget ? m : Infinity;
    attainable = currentBal >= goalTarget;
  }

  // Generate 24-month projection table for charts/table
  const projectionMonths = Math.min(36, Math.max(12, isFinite(monthsToGoal) ? monthsToGoal + 6 : 24));
  const projections = [];
  let simBalance = balanceCents;
  const today = new Date();

  for (let i = 1; i <= projectionMonths; i++) {
    const simDate = new Date(today.getFullYear(), today.getMonth() + i, 1);
    const interestCents = Math.round(simBalance * monthlyRate);
    simBalance += newMonthlySavingsCents + interestCents;

    projections.push({
      month: i,
      date: simDate.toISOString().slice(0, 7),
      balance: fromCents(simBalance),
      contribution: fromCents(newMonthlySavingsCents),
      interestEarned: fromCents(interestCents),
      goalAchieved: simBalance >= goalTarget
    });
  }

  // Projected completion date
  let projectedDate = null;
  if (isFinite(monthsToGoal) && monthsToGoal > 0) {
    const pDate = new Date(today.getFullYear(), today.getMonth() + monthsToGoal, today.getDate());
    projectedDate = pDate.toISOString().slice(0, 10);
  } else if (monthsToGoal === 0) {
    projectedDate = today.toISOString().slice(0, 10);
  }

  // Explicit assumptions list
  const assumptions = [
    `Monthly baseline income remains constant at ${formatCurrency(fromCents(monthlyIncome))}.`,
    `Monthly baseline expenses remain constant at ${formatCurrency(fromCents(monthlyExpenses))}.`,
    totalCutsCents > 0
      ? `Category spending cuts of ${formatCurrency(fromCents(totalCutsCents))}/month are sustained every month.`
      : 'No category spending cuts applied.',
    extraMonthlyIncome > 0
      ? `Additional monthly income of ${formatCurrency(fromCents(extraMonthlyIncome))} continues indefinitely.`
      : 'No extra monthly income applied.',
    oneOffExpense > 0
      ? `One-off expense of ${formatCurrency(fromCents(oneOffExpense))} is deducted immediately from current savings.`
      : 'No one-off immediate expense deducted.',
    annualInterestRate > 0
      ? `Annual investment return/interest rate of ${annualInterestRate}% compounded monthly.`
      : 'No investment interest or yield applied (0% return assumption).'
  ];

  return {
    attainable,
    currentSavings: fromCents(currentSavings),
    goalTarget: fromCents(goalTarget),
    startingBalance: fromCents(balanceCents),
    baselineMonthlySurplus: fromCents(baselineMonthlySurplusCents),
    newMonthlySavings: fromCents(newMonthlySavingsCents),
    monthsToGoal: isFinite(monthsToGoal) ? monthsToGoal : null,
    projectedDate,
    cutBreakdown,
    assumptions,
    projections,
    calculation: {
      formula: 'NewMonthlySavings = (Income - Expenses) + CategoryCuts + ExtraIncome; FutureBalance = (PrevBalance * (1 + MonthlyRate)) + NewMonthlySavings',
      inputs: {
        currentSavings: fromCents(currentSavings),
        goal: fromCents(goalTarget),
        monthlyIncome: fromCents(monthlyIncome),
        monthlyExpenses: fromCents(monthlyExpenses),
        totalCuts: fromCents(totalCutsCents),
        extraIncome: fromCents(extraMonthlyIncome),
        oneOffExpense: fromCents(oneOffExpense),
        annualInterestRate
      }
    }
  };
}

/**
 * Reconcile imported CSV rows with transactions saved in database.
 * Computes exact count, inflow, outflow and provides a pass/fail audit report.
 */
export function reconcile(importRows = [], dbTxns = []) {
  let importInflowCents = 0;
  let importOutflowCents = 0;
  let importCount = 0;

  for (const r of importRows) {
    if (!r) continue;
    const amt = toCents(r.amount);
    if (amt > 0) importInflowCents += amt;
    else if (amt < 0) importOutflowCents += Math.abs(amt);
    importCount++;
  }

  let dbInflowCents = 0;
  let dbOutflowCents = 0;
  let dbCount = 0;

  for (const t of dbTxns) {
    if (!t) continue;
    const amt = toCents(t.amount);
    if (amt > 0) dbInflowCents += amt;
    else if (amt < 0) dbOutflowCents += Math.abs(amt);
    dbCount++;
  }

  const deltaCount = importCount - dbCount;
  const deltaInflowCents = importInflowCents - dbInflowCents;
  const deltaOutflowCents = importOutflowCents - dbOutflowCents;

  const isMatch = deltaCount === 0 && deltaInflowCents === 0 && deltaOutflowCents === 0;

  return {
    pass: isMatch,
    status: isMatch ? 'PASSED' : 'DISCREPANCY_DETECTED',
    report: {
      rows: {
        importCount,
        dbCount,
        delta: deltaCount,
        pass: deltaCount === 0
      },
      inflow: {
        importInflow: fromCents(importInflowCents),
        dbInflow: fromCents(dbInflowCents),
        delta: fromCents(deltaInflowCents),
        pass: deltaInflowCents === 0
      },
      outflow: {
        importOutflow: fromCents(importOutflowCents),
        dbOutflow: fromCents(dbOutflowCents),
        delta: fromCents(deltaOutflowCents),
        pass: deltaOutflowCents === 0
      }
    },
    message: isMatch
      ? `Reconciliation passed: All ${dbCount} transactions (${formatCurrency(fromCents(dbInflowCents))} in, ${formatCurrency(fromCents(dbOutflowCents))} out) match source records.`
      : `Reconciliation notice: Discrepancy of ${deltaCount} rows (Inflow delta: ${formatCurrency(fromCents(deltaInflowCents))}, Outflow delta: ${formatCurrency(fromCents(deltaOutflowCents))}).`
  };
}
