// test/engine.test.js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  toCents,
  fromCents,
  normaliseMerchant,
  categorise,
  summarise,
  detectRecurring,
  flagAnomalies,
  runScenario,
  reconcile
} from '../shared/engine.js';
import { ANOMALY_CODES } from '../shared/constants.js';

describe('Financial Engine: Integer Cents & Precision', () => {
  test('toCents and fromCents avoid floating point drift', () => {
    assert.equal(toCents(0.1 + 0.2), 30);
    assert.equal(fromCents(30), 0.3);
    assert.equal(toCents(1250.75), 125075);
    assert.equal(fromCents(125075), 1250.75);
  });

  test('normaliseMerchant cleans digits and payment reference noise', () => {
    assert.equal(normaliseMerchant('SWIGGY*BANGALORE123/UPI'), 'Swiggy Bangalore');
    assert.equal(normaliseMerchant('Netflix.com/ref-884920'), 'Netflix');
    assert.equal(normaliseMerchant('POS 4910 Uber India'), 'Uber India');
  });
});

describe('Financial Engine: Categorisation', () => {
  test('User rules take strict precedence over keyword rules', () => {
    const txn = { description: 'Uber Trip 9283', merchant: 'Uber' };
    const userRules = [
      { merchant_pattern: 'uber', category_name: 'Work Travel' }
    ];
    const result = categorise(txn, userRules);
    assert.equal(result.category, 'Work Travel');
    assert.equal(result.source, 'user');
  });

  test('Keyword rules identify categories accurately when no user rule matches', () => {
    assert.equal(categorise({ description: 'BigBasket order #4492' }).category, 'Groceries');
    assert.equal(categorise({ description: 'Zomato delivery Biryani' }).category, 'Dining');
    assert.equal(categorise({ description: 'Netflix Monthly Plan' }).category, 'Subscriptions');
    assert.equal(categorise({ description: 'Tech Corp Payroll Salary' }).category, 'Salary');
    assert.equal(categorise({ description: 'BESCOM electricity bill' }).category, 'Utilities');
  });

  test('Unmatched transaction falls back to Uncategorised', () => {
    const res = categorise({ description: 'Random Mystery Bazaar 99' });
    assert.equal(res.category, 'Uncategorised');
    assert.equal(res.source, 'auto');
  });
});

describe('Financial Engine: Summarisation', () => {
  const sampleTxns = [
    { id: '1', txn_date: '2026-05-01', amount: 100000, category_name: 'Salary', merchant: 'Tech Corp' },
    { id: '2', txn_date: '2026-05-02', amount: -25000, category_name: 'Rent/Housing', merchant: 'Prestige' },
    { id: '3', txn_date: '2026-05-05', amount: -5000, category_name: 'Groceries', merchant: 'BigBasket' },
    { id: '4', txn_date: '2026-05-10', amount: -2000, category_name: 'Dining', merchant: 'Swiggy' },
    { id: '5', txn_date: '2026-05-15', amount: -10000, category_name: 'Transfers', merchant: 'Self Savings' } // Should be excluded from income/spending
  ];

  test('Computes exact income, spending, net and savings rate', () => {
    const summary = summarise(sampleTxns);
    assert.equal(summary.income, 100000);
    assert.equal(summary.spending, 32000); // 25000 + 5000 + 2000
    assert.equal(summary.net, 68000); // 100000 - 32000
    assert.equal(summary.savingsRate, 68.0);
    assert.equal(summary.transferTotal, 10000);
  });

  test('Excludes transfers and breaks down spending by category', () => {
    const summary = summarise(sampleTxns);
    const rentCat = summary.categories.find(c => c.name === 'Rent/Housing');
    assert.ok(rentCat);
    assert.equal(rentCat.total, 25000);
    assert.equal(rentCat.percentage, 78.1);
  });

  test('Filters by date range correctly', () => {
    const summary = summarise(sampleTxns, { from: '2026-05-01', to: '2026-05-03' });
    assert.equal(summary.income, 100000);
    assert.equal(summary.spending, 25000);
    assert.equal(summary.transactionCount, 2);
  });
});

describe('Financial Engine: Recurring Payments Detection', () => {
  const recurringTxns = [
    // Netflix: monthly approx 30 days apart, exact ₹649
    { id: 'n1', txn_date: '2026-05-15', amount: -649, merchant: 'Netflix' },
    { id: 'n2', txn_date: '2026-06-15', amount: -649, merchant: 'Netflix' },
    { id: 'n3', txn_date: '2026-07-15', amount: -649, merchant: 'Netflix' },
    { id: 'n4', txn_date: '2026-08-15', amount: -649, merchant: 'Netflix' },
    // Irregular random purchase (only 2 times, random interval)
    { id: 'r1', txn_date: '2026-05-01', amount: -1200, merchant: 'Random Shop' },
    { id: 'r2', txn_date: '2026-05-20', amount: -1200, merchant: 'Random Shop' }
  ];

  test('Identifies Netflix as monthly subscription with supporting transaction IDs', () => {
    const detected = detectRecurring(recurringTxns);
    assert.equal(detected.length, 1);
    const netflix = detected[0];
    assert.equal(netflix.merchant, 'Netflix');
    assert.equal(netflix.frequency, 'monthly');
    assert.equal(netflix.avg_amount, 649);
    assert.ok(netflix.confidence >= 0.85);
    assert.equal(netflix.txn_ids.length, 4);
    assert.equal(netflix.next_expected, '2026-09-14'); // 30 days after Aug 15
  });
});

describe('Financial Engine: Neutral Anomaly Flagging', () => {
  test('Flags duplicate charges within 48 hours with neutral explanation', () => {
    const txns = [
      { id: 'd1', txn_date: '2026-06-10T12:00:00', amount: -480, merchant: 'Swiggy', category_name: 'Dining' },
      { id: 'd2', txn_date: '2026-06-10T12:30:00', amount: -480, merchant: 'Swiggy', category_name: 'Dining' }
    ];
    const flags = flagAnomalies(txns);
    const dup = flags.find(f => f.reason_code === ANOMALY_CODES.POSSIBLE_DUPLICATE);
    assert.ok(dup);
    assert.match(dup.reason_text, /within 48 hours/i);
    assert.doesNotMatch(dup.reason_text, /fraud/i);
  });

  test('Flags price change on recurring payment', () => {
    const txns = [
      { id: 'p1', txn_date: '2026-05-15', amount: -649, merchant: 'Netflix', category_name: 'Subscriptions' },
      { id: 'p2', txn_date: '2026-06-15', amount: -649, merchant: 'Netflix', category_name: 'Subscriptions' },
      { id: 'p3', txn_date: '2026-07-15', amount: -649, merchant: 'Netflix', category_name: 'Subscriptions' },
      { id: 'p4', txn_date: '2026-08-15', amount: -799, merchant: 'Netflix', category_name: 'Subscriptions' } // increased ~23%
    ];
    const flags = flagAnomalies(txns);
    const priceFlag = flags.find(f => f.reason_code === ANOMALY_CODES.PRICE_CHANGE);
    assert.ok(priceFlag);
    assert.equal(priceFlag.txn_id, 'p4');
    assert.match(priceFlag.reason_text, /increased by 23%/i);
  });

  test('Flags new large merchant with neutral wording', () => {
    // 5 normal txns with median around ₹500
    const txns = [
      { id: 't1', txn_date: '2026-05-01', amount: -400, merchant: 'Cafe', category_name: 'Dining' },
      { id: 't2', txn_date: '2026-05-02', amount: -500, merchant: 'Grocery', category_name: 'Groceries' },
      { id: 't3', txn_date: '2026-05-03', amount: -550, merchant: 'Uber', category_name: 'Transport' },
      { id: 't4', txn_date: '2026-05-04', amount: -600, merchant: 'Medicines', category_name: 'Health' },
      { id: 't5', txn_date: '2026-05-05', amount: -89000, merchant: 'Apple Store', category_name: 'Shopping' } // One-time huge purchase
    ];
    const flags = flagAnomalies(txns);
    const newMerchFlag = flags.find(f => f.reason_code === ANOMALY_CODES.NEW_LARGE_MERCHANT);
    assert.ok(newMerchFlag);
    assert.equal(newMerchFlag.txn_id, 't5');
    assert.match(newMerchFlag.reason_text, /more than double your typical median/i);
    assert.doesNotMatch(newMerchFlag.reason_text, /fraud/i);
  });
});

describe('Financial Engine: Goal & What-If Scenarios', () => {
  test('Computes realistic timeline, monthly surplus, and lists assumptions', () => {
    const scenario = runScenario({
      currentSavings: 100000, // ₹1,00,000
      goal: 300000,          // ₹3,00,000
      monthlyIncome: 80000,
      monthlyExpenses: 60000, // baseline surplus = 20,000
      cutByCategory: { Dining: 5000 }, // cuts +5,000 -> 25,000/mo
      extraMonthlyIncome: 5000,        // extra +5,000 -> 30,000/mo
      oneOffExpense: 20000             // current balance = 80,000
    });

    assert.equal(scenario.startingBalance, 80000);
    assert.equal(scenario.baselineMonthlySurplus, 20000);
    assert.equal(scenario.newMonthlySavings, 30000);
    // Needed: 300000 - 80000 = 220000. 220000 / 30000 = 7.33 -> 8 months
    assert.equal(scenario.monthsToGoal, 8);
    assert.ok(scenario.assumptions.length >= 4);
    assert.ok(scenario.projections.length > 0);
  });
});

describe('Financial Engine: Reconciliation Audit', () => {
  test('Passes when row count, total inflow, and total outflow match exactly', () => {
    const importRows = [
      { amount: 50000 },
      { amount: -15000 },
      { amount: -3500 }
    ];
    const dbTxns = [
      { amount: 50000 },
      { amount: -15000 },
      { amount: -3500 }
    ];
    const report = reconcile(importRows, dbTxns);
    assert.equal(report.pass, true);
    assert.equal(report.status, 'PASSED');
    assert.equal(report.report.rows.delta, 0);
    assert.equal(report.report.inflow.delta, 0);
    assert.equal(report.report.outflow.delta, 0);
  });

  test('Detects discrepancy if rows or amounts do not match', () => {
    const importRows = [
      { amount: 50000 },
      { amount: -15000 },
      { amount: -3500 }
    ];
    const dbTxns = [
      { amount: 50000 },
      { amount: -15000 } // missing 1 row
    ];
    const report = reconcile(importRows, dbTxns);
    assert.equal(report.pass, false);
    assert.equal(report.status, 'DISCREPANCY_DETECTED');
    assert.equal(report.report.rows.delta, 1);
  });
});
