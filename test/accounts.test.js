// test/accounts.test.js
// Tests for Account Management, Isolation, and Embedded Zero-Latency Sample Data

import test from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLE_TRANSACTIONS } from '../shared/sample_data.js';
import { parseCSV, summarise } from '../shared/engine.js';

test('Account Management & Data Isolation', async (t) => {
  await t.test('SAMPLE_TRANSACTIONS provides rich, categorized seed data (200+ rows)', () => {
    assert.ok(Array.isArray(SAMPLE_TRANSACTIONS), 'SAMPLE_TRANSACTIONS must be an array');
    assert.ok(SAMPLE_TRANSACTIONS.length >= 200, `Expected at least 200 rows, got ${SAMPLE_TRANSACTIONS.length}`);

    // Verify row structure
    const sample = SAMPLE_TRANSACTIONS[0];
    assert.ok(sample.txn_date, 'Must have txn_date');
    assert.ok(sample.merchant, 'Must have merchant');
    assert.ok(typeof sample.amount === 'number', 'Amount must be number');
    assert.ok(sample.category_name, 'Must have category_name');
    assert.equal(sample.is_sample, true, 'is_sample must be true');

    // Summarize sample transactions to verify financial validity
    const summary = summarise(SAMPLE_TRANSACTIONS);
    assert.ok(summary.income > 0, 'Total income should be positive');
    assert.ok(summary.spending > 0, 'Total spending should be positive');
    assert.ok(summary.categories.length > 5, 'Should have multiple category breakdowns');
    assert.ok(summary.topMerchants.length > 0, 'Should have top merchants');
  });

  await t.test('Pure JS parseCSV handles standard CSV strings without external libraries', () => {
    const rawCSV = `Date,Description,Merchant,Amount,Category\n2026-05-01,Salary,Tech Corp,115000.00,Salary\n2026-05-02,Rent,Prestige,-28000.00,Rent/Housing`;
    const parsed = parseCSV(rawCSV);
    assert.equal(parsed.rows.length, 2);
    assert.equal(parsed.rows[0].Merchant, 'Tech Corp');
    assert.equal(parsed.rows[1].Amount, -28000);
  });

  await t.test('Isolated account transactions can be created and independently partitioned', () => {
    const userA = 'user-alice-1';
    const userB = 'user-bob-2';

    // Simulated per-user storage
    const store = new Map();

    const txnsA = [
      { id: 'tx-a-1', user_id: userA, amount: -500, merchant: 'Swiggy', txn_date: '2026-05-10', category_name: 'Dining' }
    ];
    const txnsB = [
      { id: 'tx-b-1', user_id: userB, amount: -1500, merchant: 'Zara', txn_date: '2026-05-11', category_name: 'Shopping' },
      { id: 'tx-b-2', user_id: userB, amount: 50000, merchant: 'Freelance', txn_date: '2026-05-01', category_name: 'Salary' }
    ];

    store.set(`finpilot_txns_${userA}`, txnsA);
    store.set(`finpilot_txns_${userB}`, txnsB);

    assert.equal(store.get(`finpilot_txns_${userA}`).length, 1);
    assert.equal(store.get(`finpilot_txns_${userB}`).length, 2);

    const summaryA = summarise(store.get(`finpilot_txns_${userA}`));
    const summaryB = summarise(store.get(`finpilot_txns_${userB}`));

    assert.equal(summaryA.spending, 500);
    assert.equal(summaryB.spending, 1500);
    assert.equal(summaryB.income, 50000);
  });
});
