// server/tools.js
// Chatbot tools that interface directly with shared/engine.js and user data

import {
  summarise,
  detectRecurring,
  flagAnomalies,
  runScenario,
  formatCurrency
} from '../shared/engine.js';
import { demoStore } from './auth.js';

/**
 * Fetch all transactions for the authenticated user
 */
async function getUserTransactions(req) {
  if (req.isDemo) {
    return req.demoData.transactions || [];
  }

  const { data, error } = await req.supabase
    .from('transactions')
    .select('*, categories(name, kind, color)')
    .order('txn_date', { ascending: false });

  if (error) {
    console.error('[Tools] Failed to fetch transactions:', error);
    return [];
  }

  // Flatten joined category name
  return (data || []).map(t => ({
    ...t,
    category_name: t.categories?.name || t.category_name || 'Uncategorised'
  }));
}

/**
 * Fetch goals for authenticated user
 */
async function getUserGoals(req) {
  if (req.isDemo) {
    return req.demoData.goals || [];
  }

  const { data, error } = await req.supabase
    .from('goals')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[Tools] Failed to fetch goals:', error);
    return [];
  }
  return data || [];
}

/**
 * Tool definitions exposed to LLM function calling
 */
export const TOOL_DEFINITIONS = [
  {
    name: 'get_summary',
    description: 'Get total income, total spending, net savings, savings rate, and transaction count for a specified date range or overall.',
    parameters: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Start date in YYYY-MM-DD format (optional)' },
        to: { type: 'string', description: 'End date in YYYY-MM-DD format (optional)' }
      }
    }
  },
  {
    name: 'get_category_breakdown',
    description: 'Get spending breakdown grouped by categories, including total amount and percentage of expenses.',
    parameters: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Start date in YYYY-MM-DD format (optional)' },
        to: { type: 'string', description: 'End date in YYYY-MM-DD format (optional)' }
      }
    }
  },
  {
    name: 'list_recurring',
    description: 'Detect and list recurring payments, subscriptions and utility bills with frequency, average amount, confidence score, and supporting transaction IDs.',
    parameters: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'list_flags',
    description: 'List unusual transactions that have been flagged for user review (e.g. price increases, possible duplicates, unusual amounts, new large merchants). Never refers to fraud.',
    parameters: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'search_transactions',
    description: 'Search for specific transactions by keyword, merchant name, category, or date range.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search term for merchant or description' },
        category: { type: 'string', description: 'Category filter (optional)' },
        from: { type: 'string', description: 'Start date YYYY-MM-DD (optional)' },
        to: { type: 'string', description: 'End date YYYY-MM-DD (optional)' }
      }
    }
  },
  {
    name: 'run_scenario',
    description: 'Simulate a what-if cash-flow and savings scenario to calculate months to reach a goal with category cuts or income changes.',
    parameters: {
      type: 'object',
      properties: {
        goal: { type: 'number', description: 'Target goal amount' },
        currentSavings: { type: 'number', description: 'Current savings balance' },
        monthlyIncome: { type: 'number', description: 'Estimated monthly income' },
        monthlyExpenses: { type: 'number', description: 'Estimated monthly expenses' },
        cutByCategory: { type: 'object', description: 'Key-value map of category name to monthly cut amount' },
        extraMonthlyIncome: { type: 'number', description: 'Additional monthly income' },
        oneOffExpense: { type: 'number', description: 'One-time lump sum expense' },
        annualInterestRate: { type: 'number', description: 'Optional annual return rate percentage (e.g. 6 for 6%)' }
      }
    }
  },
  {
    name: 'get_goal_progress',
    description: 'Get progress on all configured savings goals, including target amount, current amount, and remaining deficit.',
    parameters: {
      type: 'object',
      properties: {}
    }
  }
];

/**
 * Execute a chatbot tool call deterministically using shared/engine.js
 */
export async function executeTool(name, args = {}, req) {
  const txns = await getUserTransactions(req);

  switch (name) {
    case 'get_summary': {
      const summary = summarise(txns, { from: args.from, to: args.to });
      return {
        tool: 'get_summary',
        period: { from: args.from || 'all-time', to: args.to || 'all-time' },
        income: summary.income,
        spending: summary.spending,
        net: summary.net,
        savingsRate: summary.savingsRate,
        transactionCount: summary.transactionCount,
        topMerchants: summary.topMerchants.slice(0, 5),
        calculation: summary.calculation,
        txn_ids: summary.txn_ids.slice(0, 15) // sample IDs for citation
      };
    }

    case 'get_category_breakdown': {
      const summary = summarise(txns, { from: args.from, to: args.to });
      return {
        tool: 'get_category_breakdown',
        period: { from: args.from || 'all-time', to: args.to || 'all-time' },
        totalSpending: summary.spending,
        categories: summary.categories,
        txn_ids: summary.txn_ids.slice(0, 15)
      };
    }

    case 'list_recurring': {
      const detected = detectRecurring(txns);
      const totalMonthly = detected
        .filter(d => d.frequency === 'monthly')
        .reduce((sum, d) => sum + d.avg_amount, 0);

      const allSupportingTxnIds = detected.flatMap(d => d.txn_ids);

      return {
        tool: 'list_recurring',
        count: detected.length,
        estimatedMonthlyTotal: Number(totalMonthly.toFixed(2)),
        recurringPayments: detected,
        txn_ids: allSupportingTxnIds.slice(0, 20)
      };
    }

    case 'list_flags': {
      const flags = flagAnomalies(txns);
      return {
        tool: 'list_flags',
        disclaimer: 'These transactions are flagged for review, not confirmed issues or fraud.',
        count: flags.length,
        flags: flags,
        txn_ids: flags.map(f => f.txn_id)
      };
    }

    case 'search_transactions': {
      const q = (args.query || '').toLowerCase();
      const cat = (args.category || '').toLowerCase();
      const fromDate = args.from ? new Date(args.from) : null;
      const toDate = args.to ? new Date(args.to) : null;

      const results = txns.filter(t => {
        if (fromDate && new Date(t.txn_date) < fromDate) return false;
        if (toDate && new Date(t.txn_date) > toDate) return false;
        if (cat && !(t.category_name || '').toLowerCase().includes(cat)) return false;
        if (q) {
          const m = (t.merchant || '').toLowerCase();
          const d = (t.description || '').toLowerCase();
          if (!m.includes(q) && !d.includes(q)) return false;
        }
        return true;
      });

      return {
        tool: 'search_transactions',
        query: args.query || '',
        totalMatches: results.length,
        transactions: results.slice(0, 10).map(t => ({
          id: t.id,
          date: t.txn_date,
          merchant: t.merchant,
          description: t.description,
          amount: t.amount,
          category: t.category_name
        })),
        txn_ids: results.map(t => t.id)
      };
    }

    case 'run_scenario': {
      // If income or expenses not passed, compute from user's actual averages
      let monthlyIncome = args.monthlyIncome;
      let monthlyExpenses = args.monthlyExpenses;

      if (!monthlyIncome || !monthlyExpenses) {
        const sum = summarise(txns);
        const monthCount = Math.max(1, sum.monthly.length);
        if (!monthlyIncome) monthlyIncome = sum.income / monthCount;
        if (!monthlyExpenses) monthlyExpenses = sum.spending / monthCount;
      }

      const res = runScenario({
        goal: args.goal || 100000,
        currentSavings: args.currentSavings || 0,
        monthlyIncome,
        monthlyExpenses,
        cutByCategory: args.cutByCategory || {},
        extraMonthlyIncome: args.extraMonthlyIncome || 0,
        oneOffExpense: args.oneOffExpense || 0,
        annualInterestRate: args.annualInterestRate || 0
      });

      return {
        tool: 'run_scenario',
        ...res
      };
    }

    case 'get_goal_progress': {
      const goals = await getUserGoals(req);
      const goalList = goals.map(g => {
        const target = Number(g.target_amount) || 0;
        const current = Number(g.current_amount) || 0;
        const progressPct = target > 0 ? Number(((current / target) * 100).toFixed(1)) : 0;
        return {
          id: g.id,
          name: g.name,
          target_amount: target,
          current_amount: current,
          remaining: Math.max(0, target - current),
          progress_percent: progressPct,
          target_date: g.target_date
        };
      });

      return {
        tool: 'get_goal_progress',
        count: goalList.length,
        goals: goalList
      };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
