-- ==============================================================================
-- FINPILOT & MUNIM AI COPILOT — COMPLETE SUPABASE DATABASE SETUP
-- ==============================================================================

-- 1. Enable pgcrypto extension for UUID generation
create extension if not exists "pgcrypto";

-- ==============================================================================
-- 2. CORE FINANCIAL TABLES
-- ==============================================================================

-- Categories Table
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  name text not null,
  kind text check (kind in ('income','expense','transfer')) not null,
  color text,
  created_at timestamptz default now(),
  unique (user_id, name)
);

-- Imports Table (CSV batch history)
create table if not exists public.imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  filename text,
  is_sample boolean default false,
  row_count int default 0,
  total_in numeric(14,2) default 0,
  total_out numeric(14,2) default 0,
  created_at timestamptz default now()
);

-- Transactions Table
create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  import_id uuid references public.imports on delete cascade,
  txn_date date not null,
  description text not null,
  merchant text,
  amount numeric(14,2) not null,            -- negative = outflow, positive = inflow
  category_id uuid references public.categories on delete set null,
  category_source text default 'auto' check (category_source in ('auto','user')),
  is_sample boolean default false,
  hash text,                                -- dedupe: date+amount+description
  created_at timestamptz default now(),
  unique (user_id, hash)
);

-- Category Rules Table (learned from user categorizations)
create table if not exists public.category_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  merchant_pattern text not null,
  category_id uuid references public.categories on delete cascade,
  created_at timestamptz default now(),
  unique (user_id, merchant_pattern)
);

-- Recurring Payments Table (detected subscriptions & utilities)
create table if not exists public.recurring_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  merchant text not null,
  avg_amount numeric(14,2) not null,
  frequency text not null,
  next_expected date,
  confidence numeric(3,2),
  txn_ids uuid[],
  status text default 'detected' check (status in ('detected','confirmed','dismissed')),
  created_at timestamptz default now()
);

-- Flags Table (Unusual Activity Flagged for Neutral Review)
create table if not exists public.flags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  txn_id uuid references public.transactions on delete cascade,
  reason_code text not null,
  reason_text text not null,
  score numeric(5,2),
  status text default 'open' check (status in ('open','normal','dismissed','follow_up')),
  created_at timestamptz default now()
);

-- Goals Table
create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  name text not null,
  target_amount numeric(14,2) not null,
  current_amount numeric(14,2) default 0,
  target_date date,
  created_at timestamptz default now()
);

-- Scenarios Table (What-If simulations & timeline projections)
create table if not exists public.scenarios (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  goal_id uuid references public.goals on delete set null,
  name text not null,
  params jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz default now()
);

-- ==============================================================================
-- 3. MUNIM AI COPILOT TABLES
-- ==============================================================================

-- Chat Conversations Table
create table if not exists public.chat_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  title text default 'Financial Chat',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Chat Messages Table (Stores grounded assistant responses & citations)
create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references public.chat_conversations on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  sources jsonb default '[]'::jsonb,
  tool_calls jsonb default '[]'::jsonb,
  created_at timestamptz default now()
);

-- Chat Proposals Table (Human-in-the-loop action proposals)
create table if not exists public.chat_proposals (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references public.chat_conversations on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  action_type text not null,
  target_type text not null,
  target_id text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'rejected', 'executed')),
  explanation text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Chat Usage Table (Daily rate limits & token budget protection)
create table if not exists public.chat_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  usage_date date not null default current_date,
  tokens_used int not null default 0,
  queries_count int not null default 0,
  created_at timestamptz default now(),
  unique (user_id, usage_date)
);

-- ==============================================================================
-- 4. PERFORMANCE INDEXES
-- ==============================================================================
create index if not exists idx_transactions_user_date on public.transactions (user_id, txn_date desc);
create index if not exists idx_transactions_category on public.transactions (category_id);
create index if not exists idx_transactions_hash on public.transactions (user_id, hash);
create index if not exists idx_recurring_user on public.recurring_payments (user_id);
create index if not exists idx_flags_user_status on public.flags (user_id, status);
create index if not exists idx_rules_user_pattern on public.category_rules (user_id, merchant_pattern);
create index if not exists idx_chat_messages_conv on public.chat_messages (conversation_id, created_at asc);
create index if not exists idx_chat_proposals_status on public.chat_proposals (user_id, status);

-- ==============================================================================
-- 5. ROW LEVEL SECURITY (RLS) POLICIES
-- ==============================================================================
alter table public.categories enable row level security;
alter table public.imports enable row level security;
alter table public.transactions enable row level security;
alter table public.category_rules enable row level security;
alter table public.recurring_payments enable row level security;
alter table public.flags enable row level security;
alter table public.goals enable row level security;
alter table public.scenarios enable row level security;
alter table public.chat_conversations enable row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_proposals enable row level security;
alter table public.chat_usage enable row level security;

-- Categories RLS
create policy "Users can view own categories" on public.categories for select using (auth.uid() = user_id);
create policy "Users can insert own categories" on public.categories for insert with check (auth.uid() = user_id);
create policy "Users can update own categories" on public.categories for update using (auth.uid() = user_id);
create policy "Users can delete own categories" on public.categories for delete using (auth.uid() = user_id);

-- Imports RLS
create policy "Users can view own imports" on public.imports for select using (auth.uid() = user_id);
create policy "Users can insert own imports" on public.imports for insert with check (auth.uid() = user_id);
create policy "Users can update own imports" on public.imports for update using (auth.uid() = user_id);
create policy "Users can delete own imports" on public.imports for delete using (auth.uid() = user_id);

-- Transactions RLS
create policy "Users can view own transactions" on public.transactions for select using (auth.uid() = user_id);
create policy "Users can insert own transactions" on public.transactions for insert with check (auth.uid() = user_id);
create policy "Users can update own transactions" on public.transactions for update using (auth.uid() = user_id);
create policy "Users can delete own transactions" on public.transactions for delete using (auth.uid() = user_id);

-- Category Rules RLS
create policy "Users can view own category rules" on public.category_rules for select using (auth.uid() = user_id);
create policy "Users can insert own category rules" on public.category_rules for insert with check (auth.uid() = user_id);
create policy "Users can update own category rules" on public.category_rules for update using (auth.uid() = user_id);
create policy "Users can delete own category rules" on public.category_rules for delete using (auth.uid() = user_id);

-- Recurring Payments RLS
create policy "Users can view own recurring payments" on public.recurring_payments for select using (auth.uid() = user_id);
create policy "Users can insert own recurring payments" on public.recurring_payments for insert with check (auth.uid() = user_id);
create policy "Users can update own recurring payments" on public.recurring_payments for update using (auth.uid() = user_id);
create policy "Users can delete own recurring payments" on public.recurring_payments for delete using (auth.uid() = user_id);

-- Flags RLS
create policy "Users can view own flags" on public.flags for select using (auth.uid() = user_id);
create policy "Users can insert own flags" on public.flags for insert with check (auth.uid() = user_id);
create policy "Users can update own flags" on public.flags for update using (auth.uid() = user_id);
create policy "Users can delete own flags" on public.flags for delete using (auth.uid() = user_id);

-- Goals RLS
create policy "Users can view own goals" on public.goals for select using (auth.uid() = user_id);
create policy "Users can insert own goals" on public.goals for insert with check (auth.uid() = user_id);
create policy "Users can update own goals" on public.goals for update using (auth.uid() = user_id);
create policy "Users can delete own goals" on public.goals for delete using (auth.uid() = user_id);

-- Scenarios RLS
create policy "Users can view own scenarios" on public.scenarios for select using (auth.uid() = user_id);
create policy "Users can insert own scenarios" on public.scenarios for insert with check (auth.uid() = user_id);
create policy "Users can update own scenarios" on public.scenarios for update using (auth.uid() = user_id);
create policy "Users can delete own scenarios" on public.scenarios for delete using (auth.uid() = user_id);

-- Chat Conversations RLS
create policy "Users can view own conversations" on public.chat_conversations for select using (auth.uid() = user_id);
create policy "Users can insert own conversations" on public.chat_conversations for insert with check (auth.uid() = user_id);
create policy "Users can update own conversations" on public.chat_conversations for update using (auth.uid() = user_id);
create policy "Users can delete own conversations" on public.chat_conversations for delete using (auth.uid() = user_id);

-- Chat Messages RLS
create policy "Users can view own chat messages" on public.chat_messages for select using (auth.uid() = user_id);
create policy "Users can insert own chat messages" on public.chat_messages for insert with check (auth.uid() = user_id);

-- Chat Proposals RLS
create policy "Users can view own proposals" on public.chat_proposals for select using (auth.uid() = user_id);
create policy "Users can insert own proposals" on public.chat_proposals for insert with check (auth.uid() = user_id);
create policy "Users can update own proposals" on public.chat_proposals for update using (auth.uid() = user_id);

-- Chat Usage RLS
create policy "Users can view own usage" on public.chat_usage for select using (auth.uid() = user_id);
create policy "Users can insert own usage" on public.chat_usage for insert with check (auth.uid() = user_id);
create policy "Users can update own usage" on public.chat_usage for update using (auth.uid() = user_id);

-- ==============================================================================
-- 6. RPC HELPER: Increment Chat Usage Safely
-- ==============================================================================
create or replace function public.increment_chat_usage(p_user_id uuid, p_tokens int)
returns void
language plpgsql
security definer
as $$
begin
  insert into public.chat_usage (user_id, usage_date, tokens_used, queries_count)
  values (p_user_id, current_date, p_tokens, 1)
  on conflict (user_id, usage_date)
  do update set
    tokens_used = public.chat_usage.tokens_used + p_tokens,
    queries_count = public.chat_usage.queries_count + 1;
end;
$$;
