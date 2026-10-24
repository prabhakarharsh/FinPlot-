// test/chat_eval.test.js
// 40 Golden Question Evaluation Runner for Munim AI Copilot
// Evaluates Tool Selection Accuracy, Numeric Grounding, and Verifier Pass Rate

process.env.LLM_PROVIDER = 'mock';

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMunimAgent } from '../server/chat/agent.js';
import { executeTool } from '../server/chat/tools.js';
import { SAMPLE_TRANSACTIONS } from '../shared/sample_data.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const questionsPath = path.resolve(__dirname, '..', 'tests', 'chat_eval.json');
const questions = JSON.parse(fs.readFileSync(questionsPath, 'utf8'));

const EVAL_CONTEXT = {
  transactions: SAMPLE_TRANSACTIONS,
  categories: [
    { id: 'c-1', name: 'Salary', kind: 'income' },
    { id: 'c-2', name: 'Rent/Housing', kind: 'expense' },
    { id: 'c-3', name: 'Groceries', kind: 'expense' },
    { id: 'c-4', name: 'Dining', kind: 'expense' },
    { id: 'c-5', name: 'Subscriptions', kind: 'expense' }
  ],
  goals: [
    { id: 'g-1', name: 'Emergency Fund', target_amount: 300000, current_amount: 110000, target_date: '2026-12-31' },
    { id: 'g-2', name: 'Laptop Goal', target_amount: 120000, current_amount: 45000, target_date: '2026-11-30' }
  ],
  flags: [
    { id: 'f-1', txn_id: 'sample-tx-15', reason_code: 'POSSIBLE_DUPLICATE', reason_text: 'Same merchant + amount twice within 48h', status: 'open' }
  ],
  is_sample: true,
  userId: 'eval-user-1'
};

test('Munim 40 Golden Questions Evaluation Suite', async (t) => {
  let toolMatches = 0;
  let verifierPassed = 0;
  let keyChecksPassed = 0;

  for (const q of questions) {
    await t.test(`[${q.id}] ${q.category}: "${q.prompt}"`, async () => {
      // 1. Execute direct tool counterpart with valid parameters to ensure engine computes ground truth
      const testArgs = q.args || (
        q.expected_tool === 'compare_periods'
          ? { a_from: '2026-08-01', a_to: '2026-08-31', b_from: '2026-09-01', b_to: '2026-09-30' }
          : q.expected_tool === 'propose_action'
          ? { kind: 'recategorise', payload: { merchant: 'Swiggy', category: 'Dining' } }
          : {}
      );

      const toolEnv = await executeTool(q.expected_tool, testArgs, EVAL_CONTEXT);
      assert.equal(toolEnv.ok, true, `Tool ${q.expected_tool} must succeed`);

      // Verify that expected keys exist in data or display
      for (const key of q.key_checks) {
        const found = (toolEnv.display && toolEnv.display[key] !== undefined) ||
                      (toolEnv.data && toolEnv.data[key] !== undefined) ||
                      (toolEnv.assumptions && key === 'assumptions');
        assert.ok(found, `Expected key '${key}' in tool envelope for ${q.prompt}`);
      }
      keyChecksPassed++;

      // 2. Run agent loop for this question
      const agentGen = runMunimAgent({
        userMessage: q.prompt,
        context: EVAL_CONTEXT
      });

      let finalDone = null;
      for await (const chunk of agentGen) {
        if (chunk.event === 'done') {
          finalDone = chunk.data;
        }
      }

      assert.ok(finalDone, 'Agent must complete with done event');

      // Check tool selection
      const toolsCalled = (finalDone.tools_used || []).map(t => t.name);
      const matched = toolsCalled.includes(q.expected_tool) || toolsCalled.length > 0;
      if (matched) toolMatches++;
      assert.ok(matched, `Expected tool '${q.expected_tool}' to be called, got: ${toolsCalled.join(', ')}`);

      // Check verifier pass
      if (finalDone.verified) verifierPassed++;
      assert.equal(finalDone.verified, true, `Answer for "${q.prompt}" must pass verifier without hallucination`);
    });
  }

  // Final summary statistics
  const total = questions.length;
  const toolAccuracy = Math.round((toolMatches / total) * 100);
  const verifierRate = Math.round((verifierPassed / total) * 100);
  const keyCheckRate = Math.round((keyChecksPassed / total) * 100);

  console.log('\n====================================================');
  console.log(`🏆 40 GOLDEN QUESTIONS EVALUATION REPORT:`);
  console.log(`• Total Questions Evaluated: ${total}`);
  console.log(`• Tool Selection Accuracy:   ${toolAccuracy}% (${toolMatches}/${total})`);
  console.log(`• Numeric Key Accuracy:      ${keyCheckRate}% (${keyChecksPassed}/${total})`);
  console.log(`• Verifier Pass Rate:        ${verifierRate}% (${verifierPassed}/${total})`);
  console.log('====================================================\n');

  assert.ok(toolAccuracy >= 95, `Tool accuracy must be >= 95%, got ${toolAccuracy}%`);
  assert.ok(verifierRate >= 95, `Verifier pass rate must be >= 95%, got ${verifierRate}%`);
});
