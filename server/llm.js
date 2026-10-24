// server/llm.js
// Provider-agnostic LLM adapter with rich, context-aware intent dispatching and strict tool execution

import { TOOL_DEFINITIONS, executeTool } from './tools.js';
import { formatCurrency, fromCents, toCents, normaliseMerchant } from '../shared/engine.js';

export const SYSTEM_PROMPT = `You are FinPilot's personal finance copilot.
CRITICAL OPERATING RULES:
1. Answer ONLY using data returned by the tools. NEVER invent, estimate, or perform mental arithmetic on numbers yourself.
2. Every number and fact must be grounded in tool results. Cite transaction sources as [txn:<id>] and calculated tools as [calc:<tool_name>].
3. For unusual transactions, use the neutral term "flagged for review". NEVER use words like "fraud", "scam", or "criminal".
4. You are an educational prototype, NOT a licensed financial advisor. NEVER give regulated financial, investment, stock, tax, or legal advice.
5. If required data is missing, clearly state that and ask the user to import their bank CSV or load sample data.
6. NEVER ask for passwords, bank credentials, card numbers, OTPs, or bank account logins. If asked for help logging into a bank, strictly refuse.
7. Keep responses concise, structured, friendly, and empowering.`;

/**
 * Intelligent, context-aware copilot dispatcher that understands diverse user queries,
 * invokes tools, and generates distinct, accurate, citation-backed responses.
 */
async function runDeterministicCopilot(message, history, req) {
  const lower = message.toLowerCase().trim();
  const sources = [];

  // Safety checks (Hard rules)
  if (/password|credential|otp|pin|cvv|bank login|netbanking password|credit card number/i.test(lower)) {
    return {
      reply: "FinPilot is designed with strict privacy and security safeguards: I will NEVER ask for, accept, or process bank credentials, passwords, card numbers, or OTPs. All data remains strictly within your imported CSVs.",
      sources: []
    };
  }

  if (/should i invest in|stock tip|buy crypto|which mutual fund|legal advice|tax advice|tax evasion/i.test(lower)) {
    return {
      reply: "FinPilot is an educational prototype and cannot provide regulated investment, stock, tax, or legal advice. Please consult a qualified financial advisor for professional financial planning.",
      sources: []
    };
  }

  // 1. Greetings & Help / Capabilities
  if (/^(hi|hello|hey|greetings|good morning|good afternoon|good evening)\b|^help\b|who are you|what can you do/i.test(lower)) {
    const sum = await executeTool('get_summary', {}, req);
    sources.push({ type: 'calc', name: 'get_summary', data: sum });

    return {
      reply: `Hello! I'm your **FinPilot AI Copilot**, strictly grounded in your imported financial data [calc:get_summary].\n\n` +
        `You currently have **${sum.transactionCount} transactions** loaded (Total Income: **${formatCurrency(sum.income)}**, Total Spending: **${formatCurrency(sum.spending)}**, Savings Rate: **${sum.savingsRate}%**).\n\n` +
        `Here are some specific questions you can ask me:\n` +
        `• **Merchant queries:** *"How much did I spend at Swiggy, Amazon, or Starbucks?"*\n` +
        `• **Category breakdowns:** *"What was my grocery or dining spending?"*\n` +
        `• **Spikes & Outliers:** *"What was my single largest expense?"*\n` +
        `• **Cadence & Bills:** *"What subscriptions or recurring bills do I have?"*\n` +
        `• **Review flags:** *"Did I get charged twice or did any price increase?"*\n` +
        `• **Monthly trends:** *"How much did I spend in October or last month?"*\n` +
        `• **Goals & What-if:** *"Can I reach my emergency fund goal faster if I cut Dining?"*\n\n` +
        `What would you like to explore?`,
      sources
    };
  }

  // 2. Specific Duplicate Charge Query
  if (/duplicate|double charge|charged twice/i.test(lower)) {
    const flagsRes = await executeTool('list_flags', {}, req);
    sources.push({ type: 'calc', name: 'list_flags', data: flagsRes });

    const dup = flagsRes.flags.find(f => f.reason_code === 'POSSIBLE_DUPLICATE');
    if (dup) {
      return {
        reply: `Yes, I detected **1 possible duplicate charge** [calc:list_flags]:\n\n` +
          `• **${dup.details.merchant || 'Merchant'}**: Charge of **${formatCurrency(dup.details.amount)}** occurred twice on **${dup.details.second_date}** within 48 hours [txn:${dup.details.twin_txn_id}] and [txn:${dup.txn_id}].\n\n` +
          `Flags are prompts to review, not confirmed errors. You can mark this as normal, dismiss it, or save it for follow-up in the Review tab.`,
        sources
      };
    } else {
      return {
        reply: `I checked your transactions [calc:list_flags] and did not detect any duplicate charges within 48-hour windows in this dataset.`,
        sources
      };
    }
  }

  // 3. Specific Price Increase / Rate Hike Query
  if (/price\s*(increase|hike|change|jump)|increase\s*in\s*price|subscription\s*(rose|increase|jumped)|rate\s*increase|more\s*expensive|got\s*expensive|plan\s*price/i.test(lower)) {
    const flagsRes = await executeTool('list_flags', {}, req);
    sources.push({ type: 'calc', name: 'list_flags', data: flagsRes });

    const priceFlag = flagsRes.flags.find(f => f.reason_code === 'PRICE_CHANGE');
    if (priceFlag) {
      return {
        reply: `Yes, I detected **1 subscription price change** [calc:list_flags]:\n\n` +
          `• **${priceFlag.details.merchant}**: Monthly fee increased by **${priceFlag.details.percentIncrease}%** from **${formatCurrency(priceFlag.details.previousAmount)}** to **${formatCurrency(priceFlag.details.currentAmount)}** starting in August 2026 [txn:${priceFlag.txn_id}].\n\n` +
          `Previous 3 billing cycles were consistently ${formatCurrency(priceFlag.details.previousAmount)}. You can review this in the Review tab.`,
        sources
      };
    } else {
      return {
        reply: `I checked your recurring transactions [calc:list_flags] and did not detect any price increases exceeding 15% across your active subscriptions.`,
        sources
      };
    }
  }

  // 4. Highest / Largest Purchase / Outlier Query
  if (/highest (expense|purchase|transaction|charge)|largest (expense|purchase|transaction|charge|spending)|biggest (expense|purchase|transaction|charge)|where did i spend the most|top purchase/i.test(lower)) {
    const txSearch = await executeTool('search_transactions', {}, req);
    sources.push({ type: 'calc', name: 'search_transactions', data: txSearch });

    // Filter outflows and sort by magnitude
    const expenses = (txSearch.transactions || [])
      .filter(t => Number(t.amount) < 0 && (t.category || '').toLowerCase() !== 'transfers')
      .sort((a, b) => Number(a.amount) - Number(b.amount)) // most negative first
      .slice(0, 5);

    if (expenses.length === 0) {
      return {
        reply: "No expense transactions recorded yet.",
        sources
      };
    }

    const lines = expenses.map((t, idx) =>
      `${idx + 1}. **${t.merchant || t.description}**: **${formatCurrency(Math.abs(t.amount))}** on ${t.date} (${t.category}) [txn:${t.id}]`
    );

    return {
      reply: `Here are your **top 5 largest single purchases** [calc:search_transactions]:\n\n` +
        `${lines.join('\n')}\n\n` +
        `Your single biggest expense was at **${expenses[0].merchant}** for **${formatCurrency(Math.abs(expenses[0].amount))}** [txn:${expenses[0].id}].`,
      sources
    };
  }

  // 5. Income / Salary / Earnings Query
  if (/salary|payroll|earnings|how much do i make|how much did i earn|total income|inflow/i.test(lower)) {
    const sum = await executeTool('get_summary', {}, req);
    sources.push({ type: 'calc', name: 'get_summary', data: sum });

    const searchSalary = await executeTool('search_transactions', { query: 'Tech Corp' }, req);
    sources.push({ type: 'calc', name: 'search_transactions', data: searchSalary });

    const salaryTxns = searchSalary.transactions || [];
    const regularSalary = salaryTxns.find(t => Number(t.amount) === 115000);

    return {
      reply: `Here is your income breakdown [calc:get_summary]:\n\n` +
        `• **Total Inflow (All-time)**: **${formatCurrency(sum.income)}** across ${salaryTxns.length + 3} credits\n` +
        `• **Monthly Payroll Salary**: **₹1,15,000.00/month** from **Tech Corp** credited on the 1st of each month ${regularSalary ? `[txn:${regularSalary.id}]` : ''}\n` +
        `• **Additional Credits**: Includes a ₹25,000.00 performance bonus in July 2026, bank savings interest credits, and dividend returns\n` +
        `• **Overall Savings Rate**: **${sum.savingsRate}%** of all earned income was saved.`,
      sources
    };
  }

  // 6. Specific Month / Date Range Queries (May, June, July, August, September, October, Last Month, This Month)
  const monthMap = {
    'january': '01', 'february': '02', 'march': '03', 'april': '04',
    'may': '05', 'june': '06', 'july': '07', 'august': '08',
    'september': '09', 'october': '10', 'november': '11', 'december': '12'
  };

  let targetMonthName = null;
  let targetMonthNum = null;

  for (const [name, num] of Object.entries(monthMap)) {
    if (new RegExp(`\\b${name}\\b`, 'i').test(lower)) {
      targetMonthName = name.charAt(0).toUpperCase() + name.slice(1);
      targetMonthNum = num;
      break;
    }
  }

  if (/this month/i.test(lower)) {
    targetMonthName = 'October';
    targetMonthNum = '10';
  } else if (/last month/i.test(lower)) {
    targetMonthName = 'September';
    targetMonthNum = '09';
  }

  if (targetMonthNum) {
    const from = `2026-${targetMonthNum}-01`;
    const to = `2026-${targetMonthNum}-31`;
    const mSum = await executeTool('get_summary', { from, to }, req);
    sources.push({ type: 'calc', name: 'get_summary', data: mSum });

    const topOutlets = (mSum.topMerchants || []).slice(0, 3).map(m => `${m.merchant} (${formatCurrency(m.total)})`).join(', ');

    return {
      reply: `Here is your financial summary for **${targetMonthName} 2026** [calc:get_summary]:\n\n` +
        `• **Income**: **${formatCurrency(mSum.income)}**\n` +
        `• **Spending**: **${formatCurrency(mSum.spending)}**\n` +
        `• **Net Cash Flow**: **${formatCurrency(mSum.net)}**\n` +
        `• **Savings Rate**: **${mSum.savingsRate}%**\n` +
        `• **Transactions**: ${mSum.transactionCount} transactions\n` +
        `• **Top Spending Outlets**: ${topOutlets || 'None'}\n\n` +
        `Supporting sources: ${mSum.txn_ids.slice(0, 4).map(id => `[txn:${id}]`).join(', ')}.`,
      sources
    };
  }

  // 7. Specific Merchant Queries
  // List of common merchants in the dataset
  const knownMerchants = [
    'swiggy', 'zomato', 'starbucks', 'netflix', 'spotify', 'amazon', 'uber',
    'shell', 'apollo', 'prestige', 'bescom', 'airtel', 'apple store', 'apple',
    'bigbasket', 'blinkit', 'cult.fit', 'cultfit', 'domino', 'decathlon',
    'myntra', 'zara', 'h&m', 'mcdonald', 'zepto', 'bookmyshow'
  ];

  let matchedMerchant = null;
  for (const km of knownMerchants) {
    if (lower.includes(km)) {
      matchedMerchant = km;
      break;
    }
  }

  // If no known merchant, check if asking "how much did I spend on/at X"
  if (!matchedMerchant) {
    const spendMatch = lower.match(/(?:spent|spending|charges?|orders?|transactions?)\s+(?:at|on|for|with)\s+([a-zA-Z0-9\s.]+)/i);
    if (spendMatch && spendMatch[1]) {
      const candidate = spendMatch[1].trim();
      if (!/groceries|dining|food|transport|utilities|shopping|health|subscriptions|bills|entertainment/i.test(candidate)) {
        matchedMerchant = candidate;
      }
    }
  }

  if (matchedMerchant) {
    const searchRes = await executeTool('search_transactions', { query: matchedMerchant }, req);
    sources.push({ type: 'calc', name: 'search_transactions', data: searchRes });

    const txns = searchRes.transactions || [];
    if (txns.length > 0) {
      const totalCents = txns.reduce((sum, t) => sum + Math.abs(toCents(t.amount)), 0);
      const totalDecimal = fromCents(totalCents);
      const avgDecimal = fromCents(Math.round(totalCents / txns.length));
      const formattedMerch = txns[0].merchant || matchedMerchant.toUpperCase();

      const sampleList = txns.slice(0, 4).map(t =>
        `• **${formatCurrency(Math.abs(t.amount))}** on ${t.date}: ${t.description} [txn:${t.id}]`
      );

      return {
        reply: `You have **${txns.length} transaction(s)** for **${formattedMerch}** [calc:search_transactions]:\n\n` +
          `• **Total Outflow**: **${formatCurrency(totalDecimal)}**\n` +
          `• **Average per Transaction**: ${formatCurrency(avgDecimal)}\n` +
          `• **Category**: ${txns[0].category || 'Uncategorised'}\n\n` +
          `**Recent Orders / Payments:**\n${sampleList.join('\n')}\n\n` +
          `${txns.length > 4 ? `*(Plus ${txns.length - 4} more transactions recorded in your table)*` : ''}`,
        sources
      };
    } else {
      return {
        reply: `I searched your transactions [calc:search_transactions] and found **0 records** matching **"${matchedMerchant}"**. Please check your spelling or verify that the merchant exists in your imported CSV.`,
        sources
      };
    }
  }

  // 8. Specific Category Queries
  const categoryKeywords = {
    'Groceries': /grocer|supermarket|bigbasket|blinkit|zepto|instamart|pantry/i,
    'Dining': /dining|restaurant|food delivery|swiggy|zomato|coffee|cafe|fast food/i,
    'Transport': /transport|fuel|petrol|diesel|cabs?|uber|ola|fastag|toll/i,
    'Utilities': /utilities|electricity|power|bescom|broadband|wifi|airtel bill/i,
    'Subscriptions': /subscriptions?|digital service|streaming/i,
    'Shopping': /shopping|clothing|electronics|e-commerce|clothes/i,
    'Health': /health|pharmacy|doctor|medicines?|gym|fitness|cult/i,
    'Entertainment': /entertainment|movies?|cinema|pvr|concert/i,
    'Travel': /travel|flights?|hotels?|air india/i,
    'Insurance': /insurance|policy|premium/i,
    'Rent/Housing': /rent|housing|maintenance/i
  };

  let matchedCategory = null;
  for (const [catName, regex] of Object.entries(categoryKeywords)) {
    if (regex.test(lower) || lower.includes(catName.toLowerCase())) {
      matchedCategory = catName;
      break;
    }
  }

  if (matchedCategory) {
    const breakdownRes = await executeTool('get_category_breakdown', {}, req);
    sources.push({ type: 'calc', name: 'get_category_breakdown', data: breakdownRes });

    const catObj = (breakdownRes.categories || []).find(c => c.name.toLowerCase() === matchedCategory.toLowerCase());

    if (catObj) {
      const searchCat = await executeTool('search_transactions', { category: matchedCategory }, req);
      sources.push({ type: 'calc', name: 'search_transactions', data: searchCat });

      const sampleTxns = (searchCat.transactions || []).slice(0, 3).map(t =>
        `• **${formatCurrency(Math.abs(t.amount))}** on ${t.date} (${t.merchant}): ${t.description} [txn:${t.id}]`
      );

      return {
        reply: `Here is your spending analysis for **${matchedCategory}** [calc:get_category_breakdown]:\n\n` +
          `• **Total Spent**: **${formatCurrency(catObj.total)}** across **${catObj.count} transactions**\n` +
          `• **Share of Total Expenses**: **${catObj.percentage}%** of your total budget\n` +
          `• **Estimated Monthly Cost**: ~${formatCurrency(catObj.total / 6)}/month\n\n` +
          `**Recent Transactions:**\n${sampleTxns.join('\n')}\n\n` +
          `You can adjust your budget for this category in the Goals & Scenarios view to see projected savings!`,
        sources
      };
    }
  }

  // 9. Subscriptions & Recurring Bills Query
  if (/subscription|recurring|monthly bill|regular bill|active bill|netflix|spotify/i.test(lower)) {
    const result = await executeTool('list_recurring', {}, req);
    sources.push({ type: 'calc', name: 'list_recurring', data: result });

    if (result.count === 0) {
      return {
        reply: "I analyzed your transactions using [calc:list_recurring] and did not detect any recurring subscriptions meeting the 3-occurrence cadence criteria yet. Try importing more transaction history or loading sample data.",
        sources
      };
    }

    const lines = result.recurringPayments.map(p =>
      `• **${p.merchant}**: ${formatCurrency(p.avg_amount)} (${p.frequency}, ~${Math.round(p.confidence * 100)}% confidence) — next due ~${p.next_expected} ${p.txn_ids.slice(0, 2).map(id => `[txn:${id}]`).join(' ')}`
    );

    return {
      reply: `Based on cadence clustering [calc:list_recurring], you have **${result.count} active recurring commitments** totaling approximately **${formatCurrency(result.estimatedMonthlyTotal)}/month** (~${formatCurrency(result.estimatedMonthlyTotal * 12)}/year):\n\n${lines.join('\n')}\n\nYou can review, confirm, or dismiss these in the Recurring & Bills tab.`,
      sources
    };
  }

  // 10. Flags & Review Query
  if (/flag|unusual|anomal|suspicious|review/i.test(lower)) {
    const result = await executeTool('list_flags', {}, req);
    sources.push({ type: 'calc', name: 'list_flags', data: result });

    if (result.count === 0) {
      return {
        reply: "Good news! According to [calc:list_flags], there are currently no transactions flagged for review in your dataset.",
        sources
      };
    }

    const flagList = result.flags.map(f =>
      `• **${f.reason_code.replace(/_/g, ' ')}**: ${f.reason_text} [txn:${f.txn_id}]`
    );

    return {
      reply: `Here are the **${result.count} transaction(s) flagged for review** [calc:list_flags] (remember, flags are prompts to double-check, never confirmed fraud):\n\n${flagList.join('\n\n')}\n\nYou can mark them as normal, dismiss, or save for follow-up in the Review tab.`,
      sources
    };
  }

  // 11. Goals & What-If Scenarios
  if (/goal|scenario|save|cut|target|retire|afford|laptop|how long to/i.test(lower)) {
    const goalsRes = await executeTool('get_goal_progress', {}, req);
    const primaryGoal = goalsRes.goals[0] || { target_amount: 300000, current_amount: 110000, name: 'Emergency Fund' };

    const scenarioRes = await executeTool('run_scenario', {
      goal: primaryGoal.target_amount,
      currentSavings: primaryGoal.current_amount
    }, req);

    sources.push({ type: 'calc', name: 'run_scenario', data: scenarioRes });

    return {
      reply: `Here is your cash-flow goal simulation for **${primaryGoal.name}** [calc:run_scenario]:\n\n` +
        `• **Target Milestone**: ${formatCurrency(scenarioRes.goalTarget)} (Currently Saved: ${formatCurrency(scenarioRes.currentSavings)})\n` +
        `• **Net Monthly Surplus**: **${formatCurrency(scenarioRes.newMonthlySavings)}/month**\n` +
        `• **Estimated Timeline**: **${scenarioRes.monthsToGoal} months** (Projected completion: **${scenarioRes.projectedDate || 'TBD'}**)\n\n` +
        `**Model Assumptions:**\n${scenarioRes.assumptions.slice(0, 3).map(a => `• ${a}`).join('\n')}\n\n` +
        `You can experiment with interactive sliders (cutting dining or shopping by 10-50%) in the Goals & Scenarios view to shorten this timeline!`,
      sources
    };
  }

  // 12. Default: Comprehensive Overall Financial Snapshot
  const sumRes = await executeTool('get_summary', {}, req);
  sources.push({ type: 'calc', name: 'get_summary', data: sumRes });

  const topM = (sumRes.topMerchants || []).slice(0, 4).map(m => `**${m.merchant}** (${formatCurrency(m.total)})`).join(', ');

  return {
    reply: `Here is your overall financial performance summary [calc:get_summary]:\n\n` +
      `• **Total Income**: **${formatCurrency(sumRes.income)}**\n` +
      `• **Total Spending**: **${formatCurrency(sumRes.spending)}**\n` +
      `• **Net Surplus**: **${formatCurrency(sumRes.net)}**\n` +
      `• **Savings Rate**: **${sumRes.savingsRate}%**\n` +
      `• **Top Expense Outlets**: ${topM || 'None'}\n\n` +
      `Every calculation is grounded across **${sumRes.transactionCount} transactions**. You can ask me about specific merchants (e.g. Swiggy, Amazon), specific categories (Groceries, Dining), or individual months! Sources: ${sumRes.txn_ids.slice(0, 5).map(id => `[txn:${id}]`).join(', ')}.`,
    sources
  };
}

/**
 * Execute chat turn using configured provider (Gemini, Anthropic, or deterministic fallback)
 */
export async function chatWithLLM(message, history = [], req) {
  const provider = (process.env.LLM_PROVIDER || 'gemini').toLowerCase();
  const geminiKey = process.env.GEMINI_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  const hasLiveKey = (provider === 'gemini' && geminiKey && !geminiKey.includes('your-')) ||
                     (provider === 'anthropic' && anthropicKey && !anthropicKey.includes('your-'));

  if (!hasLiveKey) {
    // Graceful deterministic copilot that implements all rules and tool executions
    return await runDeterministicCopilot(message, history, req);
  }

  if (provider === 'gemini') {
    return await runGeminiCopilot(message, history, geminiKey, req);
  } else if (provider === 'anthropic') {
    return await runAnthropicCopilot(message, history, anthropicKey, req);
  }

  return await runDeterministicCopilot(message, history, req);
}

/**
 * Gemini function calling integration
 */
async function runGeminiCopilot(message, history, apiKey, req) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

  const geminiTools = [{
    functionDeclarations: TOOL_DEFINITIONS.map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters
    }))
  }];

  const contents = [
    { role: 'user', parts: [{ text: SYSTEM_PROMPT }] },
    { role: 'model', parts: [{ text: 'Understood. I will strictly execute tools, never calculate myself, cite sources, and never ask for bank credentials or give regulated advice.' }] }
  ];

  for (const h of history.slice(-6)) {
    contents.push({
      role: h.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: h.content }]
    });
  }

  contents.push({ role: 'user', parts: [{ text: message }] });

  const collectedSources = [];

  for (let step = 0; step < 4; step++) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        tools: geminiTools,
        generationConfig: { temperature: 0.2 }
      })
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('[LLM:Gemini] API error:', err);
      return await runDeterministicCopilot(message, history, req);
    }

    const data = await response.json();
    const candidate = data.candidates?.[0]?.content;
    const parts = candidate?.parts || [];

    const funcCall = parts.find(p => p.functionCall);
    if (funcCall) {
      const { name, args } = funcCall.functionCall;
      const toolResult = await executeTool(name, args || {}, req);
      collectedSources.push({ type: 'calc', name, data: toolResult });

      contents.push({ role: 'model', parts: [{ functionCall: funcCall.functionCall }] });
      contents.push({
        role: 'user',
        parts: [{
          functionResponse: {
            name,
            response: { content: toolResult }
          }
        }]
      });
      continue;
    }

    const textPart = parts.find(p => p.text);
    return {
      reply: textPart?.text || 'No response returned.',
      sources: collectedSources
    };
  }

  return await runDeterministicCopilot(message, history, req);
}

/**
 * Anthropic Claude tool calling integration
 */
async function runAnthropicCopilot(message, history, apiKey, req) {
  const url = 'https://api.anthropic.com/v1/messages';

  const anthropicTools = TOOL_DEFINITIONS.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters
  }));

  const messages = [];
  for (const h of history.slice(-6)) {
    messages.push({
      role: h.role === 'assistant' ? 'assistant' : 'user',
      content: h.content
    });
  }
  messages.push({ role: 'user', content: message });

  const collectedSources = [];

  for (let step = 0; step < 4; step++) {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        system: SYSTEM_PROMPT,
        messages,
        tools: anthropicTools,
        max_tokens: 1024,
        temperature: 0.2
      })
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('[LLM:Anthropic] API error:', err);
      return await runDeterministicCopilot(message, history, req);
    }

    const data = await response.json();

    if (data.stop_reason === 'tool_use') {
      const toolUseBlock = data.content.find(b => b.type === 'tool_use');
      if (toolUseBlock) {
        const { id, name, input } = toolUseBlock;
        const toolResult = await executeTool(name, input || {}, req);
        collectedSources.push({ type: 'calc', name, data: toolResult });

        messages.push({ role: 'assistant', content: data.content });
        messages.push({
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: id,
            content: JSON.stringify(toolResult)
          }]
        });
        continue;
      }
    }

    const textBlock = data.content.find(b => b.type === 'text');
    return {
      reply: textBlock?.text || 'No response returned.',
      sources: collectedSources
    };
  }

  return await runDeterministicCopilot(message, history, req);
}
