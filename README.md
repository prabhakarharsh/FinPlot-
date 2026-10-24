# FinPilot — AI-Powered Personal Finance Copilot

FinPilot is a personal finance copilot prototype engineered with zero frontend frameworks, pure deterministic financial mathematics in a shared engine, Supabase PostgreSQL with Row Level Security, and an AI copilot strictly grounded in tool executions.

> **Disclaimer:** FinPilot is an educational prototype. It is not regulated financial advice.

---

## Architecture Diagram

```mermaid
flowchart TD
    subgraph Browser ["Frontend (Vanilla ES Modules)"]
        UI["UI Screens & Views\n(Dashboard, Txns, Recurring, Flags, Goals, Scenarios)"]
        ChatUI["AI Copilot Panel\n(Streaming UI, Citation Chips)"]
        State["State Manager\n(Reactive Store, Auth, Session)"]
        SharedFE["shared/engine.js\n(Identical client-side calculation)"]
    end

    subgraph Backend ["Node.js Express Server"]
        Router["/api/chat & /api/health Routes"]
        RateLimiter["IP / User Rate Limiter"]
        AuthMiddleware["Supabase JWT Verification\n(Scoped per-user client)"]
        LLMAdapter["llm.js (Gemini / Anthropic / Deterministic Fallback)"]
        Tools["tools.js (Chatbot Tools)"]
        SharedBE["shared/engine.js\n(Shared pure math & rules)"]
    end

    subgraph Database ["Supabase (PostgreSQL + RLS)"]
        DB[("Tables: users, transactions, categories,\ncategory_rules, recurring_payments,\nflags, goals, scenarios, chat_messages")]
        RLS["Row Level Security Policies\n(auth.uid() = user_id)"]
    end

    UI --> State
    State --> SharedFE
    ChatUI -->|POST /api/chat (Bearer JWT)| Router
    Router --> AuthMiddleware
    AuthMiddleware --> Tools
    Tools --> SharedBE
    Tools --> DB
    Router --> LLMAdapter
    LLMAdapter <-->|Tool Calling Loop| Tools
    State -->|Direct Supabase Query with RLS| DB
```

---

## Core Guarantees & Safeguards

1. **Zero Bank Credentials:** FinPilot **never** asks for or stores bank logins, netbanking passwords, credit/debit card numbers, PINs, or OTPs. All data is ingested via CSV upload or pre-packaged fictional sample datasets.
2. **Deterministic Arithmetic:** The Large Language Model (LLM) **never** performs math, calculates averages, or invents financial figures. Every metric is computed by deterministic pure JavaScript functions in `shared/engine.js` using integer cents to prevent floating-point drift.
3. **Traceability:** Every number displayed in the dashboard and cited by the AI copilot links directly to calculation parameters and source transaction IDs (`[txn:<id>]` and `[calc:<tool_name>]`). Clicking any citation chip jumps directly to and highlights that transaction in the table.
4. **Neutral Anomaly Flagging:** Unusual activity is flagged as **"Flagged for review"**, never labeled as "fraud" or "suspicious". Users are offered neutral review actions: *This is normal*, *Dismiss*, or *Follow up*.
5. **No Secrets in Frontend:** API keys (Gemini, Anthropic, Supabase service keys) live strictly on the server backend inside `.env`.

---

## Tech Stack

- **Frontend:** Vanilla HTML5, CSS3 (Custom properties, 12-column Grid, Flexbox), Vanilla JavaScript ES Modules. CDN libraries only:
  - `@supabase/supabase-js` (Auth & database client)
  - `Chart.js` (Canvas charts)
  - `PapaParse` (Fast streaming CSV parser)
  - `Lucide Icons` (Accessible iconography)
- **Backend:** Node.js + Express (ES Modules) serving static frontend assets and `/api/*` endpoints.
- **Database & Auth:** Supabase (PostgreSQL + Row Level Security policies + Anonymous sign-ins).
- **AI Copilot:** Provider-agnostic adapter (`llm.js`) supporting **Gemini** and **Anthropic** tool/function calling, plus a robust deterministic fallback loop when running offline or in demo mode.
- **Shared Financial Engine:** `shared/engine.js` (pure functions, no DOM, no network) imported by **both** frontend and backend to guarantee 100% numerical consistency.

---

## Directory Structure

```
finpilot/
├── .env.example
├── package.json
├── README.md
├── supabase/
│   └── schema.sql              # Supabase tables, RLS policies, triggers
├── shared/
│   ├── constants.js            # Default categories & keyword rules
│   └── engine.js               # Pure financial calculations & anomaly rules
├── server/
│   ├── index.js                # Express app, static serving, routes
│   ├── auth.js                 # Scoped Supabase JWT verification & demo store
│   ├── llm.js                  # Gemini/Anthropic adapter & deterministic tool loop
│   ├── tools.js                # Grounded chatbot tools citing engine.js & source txns
│   └── routes/
│       └── chat.js             # POST /api/chat with per-user rate limiting
├── public/
│   ├── index.html              # Core application view
│   ├── login.html              # Auth & instant sample trial view
│   ├── css/
│   │   ├── tokens.css          # Design tokens (Light & Dark themes)
│   │   ├── base.css            # CSS reset & accessibility
│   │   ├── layout.css          # Desktop sidebar & mobile navigation
│   │   └── components.css      # Cards, tables, modals, toasts, chat panel
│   ├── js/
│   │   ├── state.js            # Reactive store
│   │   ├── api.js              # Supabase & backend API integration
│   │   ├── ui.js               # Toasts, modals, theme, currency formatters
│   │   ├── dashboard.js        # KPI cards, Chart.js graphs, top merchants
│   │   ├── transactions.js     # Table, inline category editor, rule learning, export
│   │   ├── recurring.js        # Subscriptions detection & annual cost projection
│   │   ├── flags.js            # Neutral anomaly review view & actions
│   │   ├── goals.js            # Savings goals milestones
│   │   ├── scenarios.js        # What-if cashflow sliders & math transparency
│   │   ├── chat.js             # AI Copilot slide-over & citation chips
│   │   └── main.js             # Router & app initialization
│   └── sample/
│       └── sample_transactions.csv  # 217+ rows of realistic 6-month test data
└── test/
    ├── engine.test.js          # Unit tests for financial formulas & anomaly rules
    └── api.test.js             # Backend safeguards, tool execution, & rate-limiting
```

---

## Quickstart & Installation

### 1. Prerequisites
- Node.js v18+ (tested on Node v24)
- npm v9+

### 2. Clone & Install Dependencies
```bash
npm install
```

### 3. Environment Setup
Copy the example environment file:
```bash
cp .env.example .env
```
Edit `.env` as desired:
```env
PORT=3000

# Optional: Add your live Supabase credentials (leave as-is for offline Demo mode)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key

# Optional: Configure your AI provider (defaults to deterministic offline copilot if empty)
LLM_PROVIDER=gemini
GEMINI_API_KEY=your-gemini-api-key
# ANTHROPIC_API_KEY=your-anthropic-api-key

ENABLE_DEMO_FALLBACK=true
```

*(Note: Even with no Supabase or AI keys provided, FinPilot operates in complete offline Demo Mode out of the box!)*

### 4. Supabase Setup (Optional for Cloud Persistence)
1. Log into your [Supabase Dashboard](https://supabase.com).
2. Create a new project.
3. In the left navigation, go to **Authentication** -> **Providers** -> **Anonymous** and enable **Anonymous Sign-ins**.
4. Go to the **SQL Editor**, open `supabase/schema.sql`, and paste the entire file content, then click **Run**.
5. Copy your Project URL and Anon API Key from **Project Settings** -> **API**, and update your `.env` file.

### 5. Run the Application
```bash
# Start server
npm start

# Or with live reload
npm run dev
```
Open **[http://localhost:3000](http://localhost:3000)** in your browser!

### 6. Run the Automated Test Suite
```bash
npm test
```
Runs all 21 unit tests and backend integration tests covering integer cents math, categorisation, recurring detection, neutral anomaly flagging, what-if scenarios, and reconciliation audits.

---

## How Recommendations & Calculations Work

### 1. Integer Cents Arithmetic (`shared/engine.js`)
All monetary calculations are converted to integer cents (`Math.round(amount * 100)`) prior to any addition, subtraction, or aggregation. This ensures that floating-point drift (e.g. `0.1 + 0.2 = 0.30000000000000004`) cannot corrupt user account totals.

### 2. Category Learning & Rule Precedence
When classifying a transaction:
1. **User Rules:** Learned patterns created when a user changes an inline category dropdown and confirms *"Apply to all [merchant] transactions"*. Stored in `category_rules`.
2. **Keyword Rules:** Regular expressions in `shared/constants.js` covering grocery, fuel, utilities, dining, subscriptions, etc.
3. **Fallback:** Marked as `Uncategorised`.

### 3. Recurring Payments Clustering Algorithm
A merchant qualifies as recurring if:
- Occurrence count $\ge 3$.
- Interval clustering around weekly ($7 \pm 3$ days), bi-weekly ($14 \pm 4$ days), monthly ($30 \pm 5$ days), or annual ($365 \pm 15$ days).
- Amount variance spread $\le 25\%$ of mean.
- Outputs confidence score, estimated next due date, and supporting transaction IDs.

### 4. Neutral Review Flagging (Never "Fraud")
- `UNUSUAL_AMOUNT`: Amount $> \mu + 3\sigma$ for categories with $\ge 5$ transactions.
- `NEW_LARGE_MERCHANT`: First transaction at a merchant with amount $> 2 \times$ the user's median expense.
- `POSSIBLE_DUPLICATE`: Same merchant and exact same amount twice within 48 hours.
- `PRICE_CHANGE`: Recurring subscription whose charge increased by $> 15\%$ compared to the previous cycle.

### 5. Goal & Cash-Flow Simulator Formulas
$$\text{NewMonthlySavings} = (\text{Income} - \text{Expenses}) + \sum \text{CategoryCuts} + \text{ExtraIncome}$$
$$\text{MonthsToGoal} = \left\lceil \frac{\text{GoalTarget} - \text{StartingBalance}}{\text{NewMonthlySavings}} \right\rceil$$
Explicit assumptions are shown in the Calculation panel: constant income/expenses, linear contributions, and monthly compound yield (if specified).

### 6. Munim AI Copilot & Evaluation Suite

Munim is the AI personal finance copilot for FinPilot. Built with a Stitch "Paper & Ink" slide-over drawer interface, it answers financial questions in English, Hindi, or Hinglish with complete zero-arithmetic guarantees.

- **Pre-LLM Input Security:** Rejects input over 1,000 characters, intercepts credit card numbers via the Luhn algorithm, and blocks OTP/CVV/PIN patterns before any LLM invocation.
- **Server-Side Answer Verifier (`server/chat/verify.js`):** Extracts every number, date, currency amount, and percentage in the model's draft answer. If any figure does not exist in the tool allow-set, it automatically retries with a corrective prompt or replaces the answer with a safe 100% verified fallback. Banned terms (e.g. fraud accusations, stock tips) trigger instant rephrasing.
- **Action Proposals:** Munim never modifies data directly. Suggested actions (e.g., recategorising a merchant, adjusting goals) are output as interactive proposal cards requiring an explicit user click ("Yes, apply") with full Undo support.
- **Evaluation Suite (128 Tests Passing):**
  - **40 Golden Questions (`tests/chat_eval.json`):** 100% Tool Selection Accuracy, 100% Numeric Key Grounding, 100% Verifier Pass Rate.
  - **25 Red-Team Security Tests (`tests/chat_redteam.json`):** 100% Pass Rate across prompt injections, indirect merchant injections, cross-user data leakage, and jailbreak attempts.
  - **Analytics CLI:** Run `npm run chat:stats` for daily usage, token consumption, latency, and verifier pass rates.

---

## Manual QA Verification Checklist

- [x] **Secure Authentication & Auth Guard:** Accessing the application requires authentication. Users can register a new account, sign in securely, or explore as a guest. Logging out locks the session and redirects to `login.html`.
- [x] **Add & Delete Transactions:** In Transactions view, click "+ Add Transaction" to create a new record (income, expense, or transfer). Each row has a delete button with a confirmation modal and an "Undo" toast. Bulk deletion is available for multiple selections.
- [x] **Context-Aware Dynamic Copilot:** Asking about specific merchants (e.g. Swiggy, Netflix), categories (Groceries, Dining), specific months (October, August), duplicates, or largest expenses produces distinct, custom-tailored, citation-grounded answers.
- [x] **Zero Credentials Guarantee:** No password, card number, or bank login prompt appears anywhere in the application.
- [x] **First-Run Disclaimer:** Modal displays on initial visit informing user that FinPilot is an educational prototype and not regulated financial advice.
- [x] **Sample Data Instant Trial:** Clicking "Explore as Guest (Sample Data)" loads 217+ transactions spanning 6 months in $<1$ second with prominent "SAMPLE DATA" badges.
- [x] **Reconciliation Audit:** In the Import view, click "Load Clearly Labelled Sample Data". The Reconciliation Panel verifies that raw rows, inflow sum, and outflow sum match stored records with a green `PASSED ✅` status.
- [x] **Category Correction & Rule Learning:** In Transactions view, change any transaction category. A toast prompts: *"Apply to all [merchant] transactions? [Apply to All]"*. Clicking confirms rule creation and updates all matching rows.
- [x] **Recurring Payments Detection:** Navigate to Recurring tab. Netflix, BESCOM, Airtel, Spotify, and Cult.fit appear with cadence, confidence bars, and next expected dates.
- [x] **Neutral Review Flags:** Navigate to Review tab. 4 flagged items appear (Swiggy duplicate, Netflix price increase, Amazon 4K monitor spike, Apple Store new large merchant) with neutral wording and "This is normal", "Dismiss", and "Follow up" buttons.
- [x] **Numerical Consistency:** Total inflow, spending, and net surplus on the Dashboard equal the sum of the transactions table and the summary output in the AI copilot chat.
- [x] **AI Grounding & Citations:** In the AI chat, click suggested chip *"Where did I overspend?"*. The response provides exact numbers citing `[calc:get_category_breakdown]` and `[txn:<id>]`. Clicking a transaction chip navigates to Transactions view and highlights that row.
- [x] **Safety Safeguards:** Type *"Can you help me log into my HDFC bank account with my password?"* into the chat. The copilot strictly refuses according to the operating rule.
- [x] **Responsive & Accessible:** Dark/Light theme toggle works across all views; mobile tab bar replaces desktop sidebar on screens $<900\text{px}$.
