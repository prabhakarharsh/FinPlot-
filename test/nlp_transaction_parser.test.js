// test/nlp_transaction_parser.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSpokenAmount, parseVoiceTransaction } from '../shared/nlp_transaction_parser.js';

describe('Voice & Natural Language Transaction Parser', () => {
  it('parses numeric amounts and spoken suffix formats', () => {
    assert.equal(parseSpokenAmount('300'), 300);
    assert.equal(parseSpokenAmount('₹450.50'), 450.5);
    assert.equal(parseSpokenAmount('Rs 1,500'), 1500);
    assert.equal(parseSpokenAmount('50k'), 50000);
    assert.equal(parseSpokenAmount('2.5k'), 2500);
    assert.equal(parseSpokenAmount('1 lakh'), 100000);
    assert.equal(parseSpokenAmount('five hundred'), 500);
    assert.equal(parseSpokenAmount('two thousand five hundred'), 2500);
  });

  it('correctly parses "300 for shopping"', () => {
    const res = parseVoiceTransaction('300 for shopping');
    assert.equal(res.ok, true);
    assert.equal(res.transaction.raw_amount, 300);
    assert.equal(res.transaction.amount, -300);
    assert.equal(res.transaction.type, 'expense');
    assert.equal(res.transaction.category_name, 'Shopping');
  });

  it('correctly parses "Spent 500 on petrol"', () => {
    const res = parseVoiceTransaction('Spent 500 on petrol');
    assert.equal(res.ok, true);
    assert.equal(res.transaction.raw_amount, 500);
    assert.equal(res.transaction.amount, -500);
    assert.equal(res.transaction.type, 'expense');
    assert.equal(res.transaction.category_name, 'Transport');
    assert.match(res.transaction.merchant, /petrol/i);
  });

  it('correctly parses "450 swiggy"', () => {
    const res = parseVoiceTransaction('450 swiggy');
    assert.equal(res.ok, true);
    assert.equal(res.transaction.raw_amount, 450);
    assert.equal(res.transaction.category_name, 'Dining');
    assert.match(res.transaction.merchant, /swiggy/i);
  });

  it('correctly parses "Paid 1200 at Blinkit for groceries yesterday"', () => {
    const yesterdayStr = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const res = parseVoiceTransaction('Paid 1200 at Blinkit for groceries yesterday');
    assert.equal(res.ok, true);
    assert.equal(res.transaction.raw_amount, 1200);
    assert.equal(res.transaction.category_name, 'Groceries');
    assert.equal(res.transaction.txn_date, yesterdayStr);
  });

  it('correctly parses income phrases like "Received 50000 salary from Google"', () => {
    const res = parseVoiceTransaction('Received 50000 salary from Google');
    assert.equal(res.ok, true);
    assert.equal(res.transaction.amount, 50000);
    assert.equal(res.transaction.type, 'income');
    assert.equal(res.transaction.category_name, 'Salary');
  });

  it('correctly parses Hinglish phrase "300 rupay shoping"', () => {
    const res = parseVoiceTransaction('300 rupay shoping');
    assert.equal(res.ok, true);
    assert.equal(res.transaction.raw_amount, 300);
    assert.equal(res.transaction.amount, -300);
    assert.equal(res.transaction.category_name, 'Shopping');
  });

  it('correctly parses transfer "Transferred 2000 to savings"', () => {
    const res = parseVoiceTransaction('Transferred 2000 to savings');
    assert.equal(res.ok, true);
    assert.equal(res.transaction.raw_amount, 2000);
    assert.equal(res.transaction.type, 'transfer');
    assert.equal(res.transaction.category_name, 'Transfers');
  });

  it('correctly parses "five hundred rupees for groceries"', () => {
    const res = parseVoiceTransaction('five hundred rupees for groceries');
    assert.equal(res.ok, true);
    assert.equal(res.transaction.raw_amount, 500);
    assert.equal(res.transaction.category_name, 'Groceries');
  });

  it('correctly parses "Coffee at Starbucks 250"', () => {
    const res = parseVoiceTransaction('Coffee at Starbucks 250');
    assert.equal(res.ok, true);
    assert.equal(res.transaction.raw_amount, 250);
    assert.equal(res.transaction.category_name, 'Dining');
    assert.match(res.transaction.merchant, /starbucks/i);
  });

  it('correctly parses "Electricity bill 2400"', () => {
    const res = parseVoiceTransaction('Electricity bill 2400');
    assert.equal(res.ok, true);
    assert.equal(res.transaction.raw_amount, 2400);
    assert.equal(res.transaction.category_name, 'Utilities');
  });

  it('correctly parses "5k received from freelance"', () => {
    const res = parseVoiceTransaction('5k received from freelance');
    assert.equal(res.ok, true);
    assert.equal(res.transaction.raw_amount, 5000);
    assert.equal(res.transaction.type, 'income');
  });

  it('returns helpful error message when amount is missing', () => {
    const res = parseVoiceTransaction('went to market');
    assert.equal(res.ok, false);
    assert.match(res.error, /amount/i);
  });
});
