// test/transactions.test.js
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { state } from '../public/js/state.js';
import { summarise } from '../shared/engine.js';

describe('Transaction Management: Add, Delete & Recalculate', () => {
  const initialTxns = [
    { id: 't-1', txn_date: '2026-10-01', merchant: 'Tech Corp', description: 'Salary', amount: 100000, category_name: 'Salary' },
    { id: 't-2', txn_date: '2026-10-02', merchant: 'Prestige', description: 'Rent', amount: -25000, category_name: 'Rent/Housing' },
    { id: 't-3', txn_date: '2026-10-05', merchant: 'Swiggy', description: 'Lunch', amount: -500, category_name: 'Dining' }
  ];

  beforeEach(() => {
    state.setTransactions([...initialTxns], false);
  });

  test('Adding a transaction increases transaction count and updates summary', () => {
    const beforeSum = summarise(state.transactions);
    assert.equal(beforeSum.spending, 25500);

    const newTxn = {
      id: 't-new-1',
      txn_date: '2026-10-06',
      merchant: 'Starbucks',
      description: 'Coffee',
      amount: -350,
      category_name: 'Dining'
    };

    state.setTransactions([newTxn, ...state.transactions], false);
    assert.equal(state.transactions.length, 4);

    const afterSum = summarise(state.transactions);
    assert.equal(afterSum.spending, 25850);
    assert.equal(afterSum.net, 100000 - 25850);
  });

  test('Deleting a transaction removes it and recalculates net cash flow', () => {
    // Delete Swiggy transaction
    const targetId = 't-3';
    const remaining = state.transactions.filter(t => t.id !== targetId);
    state.setTransactions(remaining, false);

    assert.equal(state.transactions.length, 2);
    assert.equal(state.transactions.find(t => t.id === targetId), undefined);

    const updatedSum = summarise(state.transactions);
    assert.equal(updatedSum.spending, 25000);
    assert.equal(updatedSum.net, 75000);
  });

  test('Bulk deleting multiple transactions removes all specified IDs', () => {
    const idsToDelete = new Set(['t-2', 't-3']);
    const remaining = state.transactions.filter(t => !idsToDelete.has(t.id));
    state.setTransactions(remaining, false);

    assert.equal(state.transactions.length, 1);
    assert.equal(state.transactions[0].merchant, 'Tech Corp');

    const updatedSum = summarise(state.transactions);
    assert.equal(updatedSum.spending, 0);
    assert.equal(updatedSum.net, 100000);
  });
});
