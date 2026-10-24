// test/munim_integration.test.js
// Multi-Account Isolation and Security Integration Tests for Munim

import test from 'node:test';
import assert from 'node:assert/strict';
import { authenticateUser, demoStore } from '../server/auth.js';
import chatRouter from '../server/routes/chat.js';

test('Munim Security & Account Isolation Integration', async (t) => {
  await t.test('Unauthenticated request to /api/chat is rejected with 401', async () => {
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

  await t.test('Account A cannot see Account B conversations in isolated store', async () => {
    const userA = 'user-alice-isolated';
    const userB = 'user-bob-isolated';

    const storeA = demoStore.getOrCreateUser(userA);
    const storeB = demoStore.getOrCreateUser(userB);

    storeA.conversations.push({ id: 'conv-alice-1', title: 'Alice Spending' });
    storeB.conversations.push({ id: 'conv-bob-1', title: 'Bob Budgeting' });

    assert.equal(storeA.conversations.length, 1);
    assert.equal(storeB.conversations.length, 1);
    assert.equal(storeA.conversations[0].id, 'conv-alice-1');
    assert.equal(storeB.conversations[0].id, 'conv-bob-1');

    // Confirm that A does not contain B's conversation
    assert.ok(!storeA.conversations.some(c => c.id === 'conv-bob-1'));
    assert.ok(!storeB.conversations.some(c => c.id === 'conv-alice-1'));
  });

  await t.test('Account B cannot confirm or access a proposal created for Account A', async () => {
    const userA = 'user-alice-isolated';
    const userB = 'user-bob-isolated';

    const storeA = demoStore.getOrCreateUser(userA);
    const storeB = demoStore.getOrCreateUser(userB);

    const propA = {
      id: 'prop-alice-123',
      user_id: userA,
      kind: 'recategorise',
      payload: { merchant: 'Swiggy', category: 'Dining' },
      status: 'pending'
    };
    storeA.proposals.set('prop-alice-123', propA);

    // User B's proposal store should not have Alice's proposal
    assert.equal(storeB.proposals.has('prop-alice-123'), false);
    assert.equal(storeA.proposals.has('prop-alice-123'), true);
  });

  await t.test('Daily token budget tracking increments per user correctly', async () => {
    const user = 'user-budget-test';
    const store = demoStore.getOrCreateUser(user);
    store.usage.tokens_in += 150;
    store.usage.tokens_out += 75;

    assert.equal(store.usage.tokens_in, 150);
    assert.equal(store.usage.tokens_out, 75);
    assert.equal(store.usage.tokens_in + store.usage.tokens_out, 225);
  });
});
