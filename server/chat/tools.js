// server/chat/tools.js
// Read-only tool execution layer for Munim AI Personal Finance Copilot
// Grounded strictly in shared/engine.js using deterministic integer-cents arithmetic

import { z } from 'zod';
import {
  summarise,
  detectRecurring,
  flagAnomalies,
  runScenario,
  formatCurrency,
  toCents,
  fromCents,
  normaliseMerchant
} from '../../shared/engine.js';

/**
 * Standard Envelope Generator
 */
export function createEnvelope({
  ok = true,
  data = {},
  display = {},
  sources = [],
  calc_id = 'calc:default',
  assumptions = [],
  truncated = false,
  error = null
}) {
  if (!ok) {
    return {
      ok: false,
      error: String(error || 'Tool execution encountered an error'),
      data: null,
      display: {},
      sources: [],
      calc_id,
      assumptions: [],
      truncated: false
    };
  }

  return {
    ok: true,
    data,
    display,
    sources,
    calc_id,
    assumptions,
    truncated
  };
}

// -------------------------------------------------------------
// TOOL DEFINITIONS & ZOD INPUT SCHEMAS
// -------------------------------------------------------------

export const TOOL_DEFINITIONS = [
  {
    name: 'get_data_overview',
    description: 'Get an overview of the user available financial data, including date range, total transaction count, active currency, and whether sample data is being viewed. Call this first if you are unsure what data exists.',
    parameters: z.object({})
  },
  {
    name: 'get_summary',
    description: 'Get total income, total spending, net cash flow, and savings rate for a specified date range (YYYY-MM-DD), with comparison against the immediately preceding period.',
    parameters: z.object({
      from: z.string().optional().describe('Start date in YYYY-MM-DD format (inclusive). If omitted, covers all history.'),
      to: z.string().optional().describe('End date in YYYY-MM-DD format (inclusive). If omitted, covers through the latest record.')
    })
  },
  {
    name: 'get_category_breakdown',
    description: 'Get spending broken down by category for a date range, with total spent and percentage of total expenditure for each category.',
    parameters: z.object({
      from: z.string().optional().describe('Start date in YYYY-MM-DD format.'),
      to: z.string().optional().describe('End date in YYYY-MM-DD format.'),
      limit: z.number().int().min(1).max(30).optional().default(10).describe('Max number of categories to return, sorted highest spending first.')
    })
  },
  {
    name: 'compare_periods',
    description: 'Compare financial performance between two periods (Period A vs Period B) by income, spending, net cash flow, and category differences.',
    parameters: z.object({
      a_from: z.string().describe('Period A start date YYYY-MM-DD'),
      a_to: z.string().describe('Period A end date YYYY-MM-DD'),
      b_from: z.string().describe('Period B start date YYYY-MM-DD'),
      b_to: z.string().describe('Period B end date YYYY-MM-DD')
    })
  },
  {
    name: 'top_merchants',
    description: 'Get top merchants ranked by total spending in a date range, optionally filtered by a specific category.',
    parameters: z.object({
      from: z.string().optional().describe('Start date YYYY-MM-DD.'),
      to: z.string().optional().describe('End date YYYY-MM-DD.'),
      category: z.string().optional().describe('Filter to transactions in this category only (e.g. Dining, Groceries).'),
      limit: z.number().int().min(1).max(25).optional().default(5).describe('Number of top merchants to retrieve.')
    })
  },
  {
    name: 'search_transactions',
    description: 'Search and filter transactions by keyword query, date range, category, or min/max amount. Capped at 25 rows with truncated flag.',
    parameters: z.object({
      query: z.string().optional().describe('Keyword search matching merchant or description (case-insensitive).'),
      from: z.string().optional().describe('Start date YYYY-MM-DD.'),
      to: z.string().optional().describe('End date YYYY-MM-DD.'),
      category: z.string().optional().describe('Exact category name filter.'),
      min_amount: z.number().optional().describe('Minimum absolute transaction amount.'),
      max_amount: z.number().optional().describe('Maximum absolute transaction amount.'),
      limit: z.number().int().min(1).max(25).optional().default(20).describe('Max transactions to return (max 25).')
    })
  },
  {
    name: 'list_recurring',
    description: 'Detect and list recurring payments, subscriptions, and regular bills, including frequency, average amount, next expected date, and monthly/annual cost totals.',
    parameters: z.object({})
  },
  {
    name: 'list_flags',
    description: 'List transactions flagged for review (e.g., potential duplicates, unusual price changes, or high first-time merchant charges) with neutral explanations. Never describe these as fraud.',
    parameters: z.object({
      status: z.enum(['open', 'dismissed', 'normal', 'follow_up', 'all']).optional().default('open').describe('Filter flags by status.')
    })
  },
  {
    name: 'get_goal_progress',
    description: 'Get current progress, target amounts, deadline dates, and remaining deficit for the user savings goals.',
    parameters: z.object({
      goal_id: z.string().optional().describe('Optional specific goal ID. If omitted, returns all active goals.')
    })
  },
  {
    name: 'run_scenario',
    description: 'Run what-if financial projections to reach a savings goal faster by cutting categories, adding extra monthly income, or factoring in one-off expenses.',
    parameters: z.object({
      goal_id: z.string().optional().describe('ID of the target goal. Defaults to first active goal if omitted.'),
      cut_by_category: z.record(z.string(), z.number()).optional().describe('Key-value pairs of category name and reduction percentage (e.g. {"Dining": 20}).'),
      extra_monthly_income: z.number().optional().describe('Extra recurring monthly income in currency units (e.g. 5000).'),
      one_off_expense: z.number().optional().describe('One-time expense to absorb (e.g. 15000).'),
      interest_rate: z.number().optional().describe('Annual interest rate percentage on savings (e.g. 4 for 4% p.a.). Defaults to 0.')
    })
  },
  {
    name: 'propose_action',
    description: 'Propose a financial action (such as recategorising a merchant, creating a goal, or dismissing a review flag) for the user to confirm via an interactive UI card. This tool does NOT modify data directly.',
    parameters: z.object({
      kind: z.enum(['recategorise', 'create_goal', 'confirm_recurring', 'dismiss_flag', 'add_transaction']).describe('Action type.'),
      payload: z.record(z.string(), z.any()).describe('Payload parameters for the proposed action.')
    })
  }
];

/**
 * Execute a tool call against the user's dataset
 */
export async function executeTool(name, rawArgs, context) {
  const tool = TOOL_DEFINITIONS.find(t => t.name === name);
  if (!tool) {
    return createEnvelope({
      ok: false,
      error: `Unknown tool '${name}' requested.`
    });
  }

  // 1. Validate inputs via Zod
  const validation = tool.parameters.safeParse(rawArgs || {});
  if (!validation.success) {
    const errorDetails = validation.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ');
    return createEnvelope({
      ok: false,
      error: `Invalid arguments for ${name}: ${errorDetails}`,
      calc_id: `error:${name}`
    });
  }

  const args = validation.data;
  const { transactions = [], categories = [], goals = [], rules = [], flags = [], is_sample = false, userId = 'user' } = context;

  try {
    switch (name) {
      case 'get_data_overview': {
        if (!transactions.length) {
          return createEnvelope({
            ok: true,
            data: { count: 0, from: null, to: null, is_sample, currency: 'INR', categories_count: categories.length },
            display: {
              summary: 'No transactions found. Please add your transactions or import your bank statement CSV to get started.',
              count: '0 transactions',
              data_type: is_sample ? 'Sample Data' : 'User Imported Data'
            },
            calc_id: 'data_overview',
            assumptions: ['No active transactions in database']
          });
        }

        const sortedDates = transactions
          .map(t => t.txn_date)
          .filter(Boolean)
          .sort();
        const from = sortedDates[0];
        const to = sortedDates[sortedDates.length - 1];

        return createEnvelope({
          ok: true,
          data: {
            count: transactions.length,
            from,
            to,
            is_sample,
            currency: 'INR',
            categories_count: categories.length
          },
          display: {
            date_range: `${from} to ${to}`,
            total_transactions: `${transactions.length} records`,
            data_type: is_sample ? 'Sample Data (Educational Prototype)' : 'Personal Imported Data',
            currency: 'INR (₹)'
          },
          calc_id: 'data_overview',
          assumptions: ['Includes all active transactions for the authenticated user']
        });
      }

      case 'get_summary': {
        const { from, to } = args;
        const currentSummary = summarise(transactions, { from, to });

        // Calculate preceding period comparison if dates given
        let comparison = null;
        let compDisplay = {};
        if (from && to) {
          const fromDate = new Date(from);
          const toDate = new Date(to);
          const diffMs = toDate - fromDate;
          if (diffMs > 0) {
            const prevTo = new Date(fromDate.getTime() - 86400000).toISOString().split('T')[0];
            const prevFrom = new Date(fromDate.getTime() - 86400000 - diffMs).toISOString().split('T')[0];
            const prevSummary = summarise(transactions, { from: prevFrom, to: prevTo });
            
            const spendDiff = currentSummary.spending - prevSummary.spending;
            comparison = {
              prev_period: `${prevFrom} to ${prevTo}`,
              prev_spending: prevSummary.spending,
              spending_change: spendDiff,
              spending_change_pct: prevSummary.spending > 0 ? Number(((spendDiff / prevSummary.spending) * 100).toFixed(1)) : 0
            };
            compDisplay = {
              previous_period_spending: formatCurrency(prevSummary.spending),
              spending_change: `${spendDiff >= 0 ? '+' : ''}${formatCurrency(spendDiff)} (${comparison.spending_change_pct}%)`
            };
          }
        }

        // Collect source transaction IDs (up to 15 key records)
        const sources = transactions
          .filter(t => (!from || t.txn_date >= from) && (!to || t.txn_date <= to))
          .slice(0, 15)
          .map(t => ({
            type: 'txn',
            id: t.id,
            label: `${t.merchant || t.description} · ${t.txn_date} · ${formatCurrency(Math.abs(t.amount))}`
          }));

        return createEnvelope({
          ok: true,
          data: {
            period: { from: from || 'earliest', to: to || 'latest' },
            income: currentSummary.income,
            spending: currentSummary.spending,
            net: currentSummary.net,
            savings_rate: currentSummary.savingsRate,
            transaction_count: currentSummary.count,
            comparison
          },
          display: {
            total_income: formatCurrency(currentSummary.income),
            total_spent: formatCurrency(currentSummary.spending),
            net_savings: formatCurrency(currentSummary.net),
            savings_rate: `${currentSummary.savingsRate}%`,
            period_label: from && to ? `${from} to ${to}` : 'All Time',
            ...compDisplay
          },
          sources,
          calc_id: `summary:${from || 'all'}_to_${to || 'all'}`,
          assumptions: [
            'All totals calculated using integer cents arithmetic',
            'Transfers between own accounts are excluded from spending and income',
            'Negative amounts represent expenditure; positive amounts represent inflow'
          ]
        });
      }

      case 'get_category_breakdown': {
        const { from, to, limit } = args;
        const summary = summarise(transactions, { from, to });
        const categoriesData = (summary.categories || []).slice(0, limit);

        const display = {};
        const sources = [];

        categoriesData.forEach(cat => {
          display[cat.name] = `${formatCurrency(cat.amount)} (${cat.pct}%)`;
        });

        // Collect top transactions in top 3 categories as sources
        const topCatNames = new Set(categoriesData.slice(0, 3).map(c => c.name));
        transactions
          .filter(t => topCatNames.has(t.category_name))
          .filter(t => (!from || t.txn_date >= from) && (!to || t.txn_date <= to))
          .slice(0, 15)
          .forEach(t => {
            sources.push({
              type: 'txn',
              id: t.id,
              label: `${t.category_name}: ${t.merchant || t.description} (${formatCurrency(Math.abs(t.amount))})`
            });
          });

        return createEnvelope({
          ok: true,
          data: {
            categories: categoriesData,
            total_spending: summary.spending,
            period: { from: from || 'all', to: to || 'all' }
          },
          display: {
            ...display,
            total_category_spending: formatCurrency(summary.spending),
            top_category: categoriesData[0] ? `${categoriesData[0].name} (${formatCurrency(categoriesData[0].amount)})` : 'None'
          },
          sources,
          calc_id: `categories:${from || 'all'}_to_${to || 'all'}`,
          assumptions: [
            'Only expense categories are included in breakdown percentages',
            'Transfers excluded'
          ]
        });
      }

      case 'compare_periods': {
        const { a_from, a_to, b_from, b_to } = args;
        const sumA = summarise(transactions, { from: a_from, to: a_to });
        const sumB = summarise(transactions, { from: b_from, to: b_to });

        const spendDiff = sumB.spending - sumA.spending;
        const incomeDiff = sumB.income - sumA.income;
        const netDiff = sumB.net - sumA.net;

        const spendChangePct = sumA.spending > 0 ? Number(((spendDiff / sumA.spending) * 100).toFixed(1)) : 0;
        const incomeChangePct = sumA.income > 0 ? Number(((incomeDiff / sumA.income) * 100).toFixed(1)) : 0;

        return createEnvelope({
          ok: true,
          data: {
            period_a: { from: a_from, to: a_to, spending: sumA.spending, income: sumA.income, net: sumA.net },
            period_b: { from: b_from, to: b_to, spending: sumB.spending, income: sumB.income, net: sumB.net },
            delta: {
              spending_diff: spendDiff,
              spending_change_pct: spendChangePct,
              income_diff: incomeDiff,
              income_change_pct: incomeChangePct,
              net_diff: netDiff
            }
          },
          display: {
            period_a_spending: formatCurrency(sumA.spending),
            period_b_spending: formatCurrency(sumB.spending),
            spending_difference: `${spendDiff >= 0 ? '+' : ''}${formatCurrency(spendDiff)} (${spendChangePct}%)`,
            period_a_income: formatCurrency(sumA.income),
            period_b_income: formatCurrency(sumB.income),
            net_difference: `${netDiff >= 0 ? '+' : ''}${formatCurrency(netDiff)}`
          },
          sources: [],
          calc_id: `compare:${a_from}_to_${b_to}`,
          assumptions: ['Direct delta calculated between both periods using integer cents arithmetic']
        });
      }

      case 'top_merchants': {
        const { from, to, category, limit } = args;
        let filtered = transactions.filter(t => Number(t.amount) < 0);
        if (from) filtered = filtered.filter(t => t.txn_date >= from);
        if (to) filtered = filtered.filter(t => t.txn_date <= to);
        if (category) filtered = filtered.filter(t => (t.category_name || '').toLowerCase() === category.toLowerCase());

        const merchantMap = new Map();
        for (const t of filtered) {
          const m = normaliseMerchant(t.merchant || t.description || 'Unknown');
          const current = merchantMap.get(m) || { merchant: t.merchant || m, count: 0, totalCents: 0, ids: [] };
          current.count += 1;
          current.totalCents += toCents(Math.abs(t.amount));
          if (current.ids.length < 5) current.ids.push(t.id);
          merchantMap.set(m, current);
        }

        const sorted = Array.from(merchantMap.values())
          .map(item => ({
            merchant: item.merchant,
            count: item.count,
            total: fromCents(item.totalCents),
            ids: item.ids
          }))
          .sort((a, b) => b.total - a.total)
          .slice(0, limit);

        const display = {};
        const sources = [];
        sorted.forEach((item, idx) => {
          display[`rank_${idx + 1}_${item.merchant}`] = `${formatCurrency(item.total)} (${item.count} transactions)`;
          item.ids.forEach(id => {
            sources.push({ type: 'txn', id, label: `${item.merchant} · ${formatCurrency(item.total)}` });
          });
        });

        return createEnvelope({
          ok: true,
          data: { top_merchants: sorted, category_filter: category || 'all', limit },
          display: {
            ...display,
            top_merchant_name: sorted[0] ? sorted[0].merchant : 'None',
            top_merchant_amount: sorted[0] ? formatCurrency(sorted[0].total) : '₹0'
          },
          sources: sources.slice(0, 20),
          calc_id: `top_merchants:${category || 'all'}:${limit}`,
          assumptions: ['Merchants normalised to strip terminal reference noise and transaction IDs']
        });
      }

      case 'search_transactions': {
        const { query, from, to, category, min_amount, max_amount, limit } = args;
        let results = [...transactions];

        if (query) {
          const q = query.toLowerCase();
          results = results.filter(t =>
            (t.description || '').toLowerCase().includes(q) ||
            (t.merchant || '').toLowerCase().includes(q)
          );
        }

        if (from) results = results.filter(t => t.txn_date >= from);
        if (to) results = results.filter(t => t.txn_date <= to);
        if (category) results = results.filter(t => (t.category_name || '').toLowerCase() === category.toLowerCase());
        if (min_amount !== undefined) results = results.filter(t => Math.abs(t.amount) >= min_amount);
        if (max_amount !== undefined) results = results.filter(t => Math.abs(t.amount) <= max_amount);

        const totalMatching = results.length;
        const truncated = totalMatching > limit;
        const capped = results.slice(0, limit);

        const sources = capped.map(t => ({
          type: 'txn',
          id: t.id,
          label: `${t.merchant || t.description} · ${t.txn_date} · ${formatCurrency(Math.abs(t.amount))}`
        }));

        const totalSpent = capped
          .filter(t => Number(t.amount) < 0)
          .reduce((sum, t) => sum + Math.abs(Number(t.amount)), 0);

        return createEnvelope({
          ok: true,
          data: {
            count: capped.length,
            total_matching: totalMatching,
            transactions: capped.map(t => ({
              id: t.id,
              date: t.txn_date,
              merchant: t.merchant,
              description: t.description,
              amount: t.amount,
              category: t.category_name
            }))
          },
          display: {
            matching_count: `${totalMatching} records found${truncated ? ` (showing first ${limit})` : ''}`,
            total_value_shown: formatCurrency(totalSpent)
          },
          sources,
          calc_id: `search:${query || 'all'}:${limit}`,
          assumptions: ['Transactions sorted in reverse chronological order'],
          truncated
        });
      }

      case 'list_recurring': {
        const recurring = detectRecurring(transactions);
        
        let monthlyTotalCents = 0;
        let annualTotalCents = 0;

        const enriched = recurring.map(r => {
          const avgCents = toCents(r.avg_amount);
          let monthlyCents = 0;
          let annualCents = 0;

          if (r.frequency === 'weekly') {
            monthlyCents = Math.round((avgCents * 52) / 12);
            annualCents = avgCents * 52;
          } else if (r.frequency === 'bi-weekly') {
            monthlyCents = Math.round((avgCents * 26) / 12);
            annualCents = avgCents * 26;
          } else if (r.frequency === 'monthly') {
            monthlyCents = avgCents;
            annualCents = avgCents * 12;
          } else if (r.frequency === 'yearly') {
            monthlyCents = Math.round(avgCents / 12);
            annualCents = avgCents;
          }

          monthlyTotalCents += monthlyCents;
          annualTotalCents += annualCents;

          return {
            ...r,
            monthly_cost: fromCents(monthlyCents),
            annual_cost: fromCents(annualCents)
          };
        });

        const display = {
          total_recurring_items: `${enriched.length} regular commitments`,
          monthly_total_cost: formatCurrency(fromCents(monthlyTotalCents)),
          annual_total_cost: formatCurrency(fromCents(annualTotalCents))
        };

        const sources = [];
        enriched.forEach(r => {
          display[`recurring_${r.merchant}`] = `${formatCurrency(r.avg_amount)} (${r.frequency}, next: ${r.next_expected})`;
          (r.txn_ids || []).slice(0, 3).forEach(id => {
            sources.push({ type: 'recurring', id, label: `${r.merchant} (${formatCurrency(r.avg_amount)})` });
          });
        });

        return createEnvelope({
          ok: true,
          data: {
            recurring: enriched,
            total_monthly: fromCents(monthlyTotalCents),
            total_annual: fromCents(annualTotalCents)
          },
          display,
          sources: sources.slice(0, 20),
          calc_id: 'recurring_detection',
          assumptions: [
            'Detected with at least 3 repeat occurrences within +/-10% amount variance',
            'Intervals cluster around 7, 14, 30, or 365 days (+/- 3 days tolerance)'
          ]
        });
      }

      case 'list_flags': {
        const { status } = args;
        const allFlags = flagAnomalies(transactions);
        const filteredFlags = status && status !== 'all'
          ? allFlags.filter(f => (f.status || 'open') === status)
          : allFlags;

        const display = {
          flags_count: `${filteredFlags.length} items flagged for review`
        };

        const sources = [];
        filteredFlags.slice(0, 10).forEach((f, idx) => {
          display[`flag_${idx + 1}`] = `${f.reason_code}: ${f.reason_text}`;
          if (f.txn_id) {
            sources.push({ type: 'flag', id: f.txn_id, label: `Flagged: ${f.reason_text}` });
          }
        });

        return createEnvelope({
          ok: true,
          data: {
            flags: filteredFlags,
            count: filteredFlags.length
          },
          display,
          sources,
          calc_id: 'anomaly_flags',
          assumptions: [
            'Items are flagged for review using neutral criteria (duplicates, statistical deviations, price shifts)',
            'Flags are strictly review indicators and never imply fraud'
          ]
        });
      }

      case 'get_goal_progress': {
        const { goal_id } = args;
        let selectedGoals = [...goals];
        if (goal_id) {
          selectedGoals = selectedGoals.filter(g => g.id === goal_id);
        }

        const enriched = selectedGoals.map(g => {
          const target = Number(g.target_amount) || 1;
          const current = Number(g.current_amount) || 0;
          const remaining = Math.max(0, target - current);
          const progressPct = Number(((current / target) * 100).toFixed(1));

          return {
            id: g.id,
            name: g.name,
            target_amount: target,
            current_amount: current,
            remaining_amount: remaining,
            progress_pct: progressPct,
            target_date: g.target_date
          };
        });

        const display = {};
        const sources = [];

        enriched.forEach(g => {
          display[`goal_${g.name}`] = `${formatCurrency(g.current_amount)} of ${formatCurrency(g.target_amount)} (${g.progress_pct}%, deficit: ${formatCurrency(g.remaining_amount)})`;
          sources.push({ type: 'goal', id: g.id, label: `Goal: ${g.name} (${g.progress_pct}%)` });
        });

        return createEnvelope({
          ok: true,
          data: { goals: enriched },
          display: {
            ...display,
            active_goals_count: `${enriched.length} active goals`
          },
          sources,
          calc_id: `goals_progress:${goal_id || 'all'}`,
          assumptions: ['Goal progress evaluated against stated current and target allocations']
        });
      }

      case 'run_scenario': {
        const { goal_id, cut_by_category, extra_monthly_income, one_off_expense, interest_rate } = args;
        const targetGoal = goals.find(g => !goal_id || g.id === goal_id) || goals[0] || {
          id: 'goal-demo',
          name: 'Emergency Fund',
          target_amount: 300000,
          current_amount: 110000,
          target_date: '2026-12-31'
        };

        // Determine baseline monthly income and expenses from history (last 3 months or overall)
        const summary = summarise(transactions);
        const monthlyMonths = Math.max(1, (summary.monthly || []).length);
        const monthlyIncome = Math.round(summary.income / monthlyMonths);
        const monthlyExpenses = Math.round(summary.spending / monthlyMonths);

        const scenarioResult = runScenario({
          currentSavings: targetGoal.current_amount,
          goal: targetGoal.target_amount,
          monthlyIncome,
          monthlyExpenses,
          cutByCategory: cut_by_category,
          extraMonthlyIncome: extra_monthly_income || 0,
          oneOffExpense: one_off_expense || 0
        });

        const display = {
          goal_name: targetGoal.name,
          target_amount: formatCurrency(targetGoal.target_amount),
          baseline_surplus: formatCurrency(monthlyIncome - monthlyExpenses),
          scenario_monthly_surplus: formatCurrency(scenarioResult.monthlySurplus),
          months_to_goal: `${scenarioResult.monthsToGoal} months`,
          projected_completion_date: scenarioResult.projectedDate,
          is_achievable: scenarioResult.achievable ? 'Yes' : 'No (Deficit)'
        };

        return createEnvelope({
          ok: true,
          data: {
            goal: targetGoal,
            baseline: { monthly_income: monthlyIncome, monthly_expenses: monthlyExpenses },
            scenario: scenarioResult
          },
          display,
          sources: [{ type: 'goal', id: targetGoal.id, label: `Scenario: ${targetGoal.name}` }],
          calc_id: `scenario:${targetGoal.id}`,
          assumptions: scenarioResult.assumptions
        });
      }

      case 'propose_action': {
        const { kind, payload } = args;
        const proposalId = `prop-${Date.now()}-${Math.random().toString(36).substring(7)}`;

        let summaryText = 'Proposed action';
        if (kind === 'recategorise') {
          summaryText = `Change category for ${payload.merchant || 'merchant'} to "${payload.category}"?`;
        } else if (kind === 'create_goal') {
          summaryText = `Create new savings goal: "${payload.name}" with target ${formatCurrency(payload.target_amount)} by ${payload.target_date}?`;
        } else if (kind === 'confirm_recurring') {
          summaryText = `Confirm recurring payment: ${payload.merchant} (${formatCurrency(payload.amount)} ${payload.frequency})?`;
        } else if (kind === 'dismiss_flag') {
          summaryText = `Dismiss review flag for transaction ${payload.txn_id}?`;
        } else if (kind === 'add_transaction') {
          const typeStr = (payload.type || 'expense').toLowerCase();
          const amtStr = formatCurrency(Math.abs(payload.amount || 0));
          summaryText = `Record ${typeStr} of ${amtStr} for "${payload.merchant || 'merchant'}" (${payload.category || payload.category_name || 'Uncategorised'})?`;
        }

        return createEnvelope({
          ok: true,
          data: {
            proposal_id: proposalId,
            kind,
            payload,
            status: 'pending',
            requires_user_confirmation: true
          },
          display: {
            proposal_summary: summaryText,
            confirmation_prompt: 'Please click "Yes, apply" to execute this change.'
          },
          sources: payload.txn_id ? [{ type: 'txn', id: payload.txn_id, label: summaryText }] : [],
          calc_id: `proposal:${proposalId}`,
          assumptions: ['No database state has been altered; action remains pending until user confirmation']
        });
      }

      default:
        return createEnvelope({
          ok: false,
          error: `Unhandled tool '${name}'`
        });
    }
  } catch (err) {
    return createEnvelope({
      ok: false,
      error: `Tool ${name} failed: ${err.message}`,
      calc_id: `error:${name}`
    });
  }
}
