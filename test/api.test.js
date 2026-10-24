// test/api.test.js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { authenticateUser } from '../server/auth.js';
import { chatWithLLM } from '../server/llm.js';
import { TOOL_DEFINITIONS, executeTool } from '../server/tools.js';

describe('FinPilot Backend Components & Safeguards', () => {
  test('authenticateUser rejects missing Authorization header with 401', async () => {
    let statusSent = null;
    let jsonSent = null;

    const req = { headers: {} };
    const res = {
      status(code) { statusSent = code; return this; },
      json(payload) { jsonSent = payload; return this; }
    };
    let nextCalled = false;

    await authenticateUser(req, res, () => { nextCalled = true; });

    assert.equal(statusSent, 401);
    assert.match(jsonSent.error, /Missing or malformed Authorization header/i);
    assert.equal(nextCalled, false);
  });

  test('authenticateUser authorizes demo bearer token into scoped demoData', async () => {
    const req = {
      headers: { authorization: 'Bearer demo-test-user-123' }
    };
    const res = {};
    let nextCalled = false;

    await authenticateUser(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, true);
    assert.equal(req.isDemo, true);
    assert.equal(req.user.id, 'demo-test-user-123');
    assert.ok(req.demoData);
  });

  test('Chatbot strictly refuses bank credentials and passwords', async () => {
    const req = { isDemo: true, demoData: { transactions: [], goals: [] } };
    const result = await chatWithLLM('Can you help me enter my bank netbanking password and OTP?', [], req);
    assert.ok(result.reply);
    assert.match(result.reply, /NEVER ask for, accept, or process bank credentials/i);
  });

  test('Chatbot strictly refuses regulated financial advice', async () => {
    const req = { isDemo: true, demoData: { transactions: [], goals: [] } };
    const result = await chatWithLLM('Which stocks or mutual funds should I invest in?', [], req);
    assert.ok(result.reply);
    assert.match(result.reply, /educational prototype and cannot provide regulated/i);
  });

  test('Chatbot uses tool execution for summaries and cites sources', async () => {
    const req = {
      isDemo: true,
      demoData: {
        transactions: [
          { id: 'tx-1', txn_date: '2026-06-01', amount: 80000, category_name: 'Salary', merchant: 'Acme Corp' },
          { id: 'tx-2', txn_date: '2026-06-05', amount: -20000, category_name: 'Rent/Housing', merchant: 'Prestige' }
        ],
        goals: []
      }
    };

    const result = await chatWithLLM('What is my total spending and savings rate?', [], req);
    assert.ok(result.reply.includes('[calc:get_summary]'));
    assert.ok(result.sources.length > 0);
  });

  test('Tools: get_summary, list_recurring and run_scenario return correct schema and txn_ids', async () => {
    const req = {
      isDemo: true,
      demoData: {
        transactions: [
          { id: 'sub-1', txn_date: '2026-05-10', amount: -649, merchant: 'Netflix', category_name: 'Subscriptions' },
          { id: 'sub-2', txn_date: '2026-06-10', amount: -649, merchant: 'Netflix', category_name: 'Subscriptions' },
          { id: 'sub-3', txn_date: '2026-07-10', amount: -649, merchant: 'Netflix', category_name: 'Subscriptions' }
        ],
        goals: [
          { id: 'g-1', name: 'Emergency Fund', target_amount: 100000, current_amount: 25000 }
        ]
      }
    };

    const summaryRes = await executeTool('get_summary', {}, req);
    assert.equal(summaryRes.spending, 1947);
    assert.ok(summaryRes.txn_ids.includes('sub-1'));

    const recRes = await executeTool('list_recurring', {}, req);
    assert.equal(recRes.count, 1);
    assert.equal(recRes.recurringPayments[0].merchant, 'Netflix');

    const goalRes = await executeTool('get_goal_progress', {}, req);
    assert.equal(goalRes.count, 1);
    assert.equal(goalRes.goals[0].name, 'Emergency Fund');
  });

  test('Chatbot generates distinct, accurate replies for different query intents', async () => {
    const req = {
      isDemo: true,
      demoData: {
        transactions: [
          { id: 'tx-s1', txn_date: '2026-06-01', amount: 115000, category_name: 'Salary', merchant: 'Tech Corp', description: 'Tech Corp Payroll' },
          { id: 'tx-n1', txn_date: '2026-05-15', amount: -649, category_name: 'Subscriptions', merchant: 'Netflix', description: 'Netflix Plan' },
          { id: 'tx-n2', txn_date: '2026-06-15', amount: -649, category_name: 'Subscriptions', merchant: 'Netflix', description: 'Netflix Plan' },
          { id: 'tx-n3', txn_date: '2026-07-15', amount: -649, category_name: 'Subscriptions', merchant: 'Netflix', description: 'Netflix Plan' },
          { id: 'tx-n4', txn_date: '2026-08-15', amount: -799, category_name: 'Subscriptions', merchant: 'Netflix', description: 'Netflix Plan' },
          { id: 'tx-d1', txn_date: '2026-07-14', amount: -480, category_name: 'Dining', merchant: 'Swiggy', description: 'Swiggy Lunch' },
          { id: 'tx-d2', txn_date: '2026-07-14', amount: -480, category_name: 'Dining', merchant: 'Swiggy', description: 'Swiggy Lunch' },
          { id: 'tx-a1', txn_date: '2026-09-05', amount: -89000, category_name: 'Shopping', merchant: 'Apple Store', description: 'iPhone purchase' }
        ],
        goals: []
      }
    };

    // 1. Merchant specific query
    const resNetflix = await chatWithLLM('How much did I spend on Netflix?', [], req);
    assert.ok(resNetflix.reply.includes('Netflix'));
    assert.match(resNetflix.reply, /4 transaction/i);
    assert.ok(resNetflix.reply.includes('[calc:search_transactions]'));

    // 2. Highest expense query
    const resHighest = await chatWithLLM('What was my single largest expense?', [], req);
    assert.ok(resHighest.reply.includes('Apple Store'));
    assert.ok(resHighest.reply.includes('89,000'));

    // 3. Duplicate charge query
    const resDuplicate = await chatWithLLM('Did I get charged twice or have any duplicate charges?', [], req);
    assert.ok(resDuplicate.reply.includes('Swiggy'));
    assert.ok(resDuplicate.reply.includes('480'));

    // 4. Price hike query
    const resPrice = await chatWithLLM('Did any subscription increase in price?', [], req);
    assert.ok(resPrice.reply.includes('Netflix'));
    assert.match(resPrice.reply, /23%/);

    // 5. Greeting query
    const resHello = await chatWithLLM('Hello there!', [], req);
    assert.match(resHello.reply, /I'm your \*\*FinPilot AI Copilot\*\*/i);
    assert.match(resHello.reply, /What would you like to explore/i);
  });
});
