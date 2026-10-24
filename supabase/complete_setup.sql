-- ==============================================================================
-- FINPILOT & MUNIM AI COPILOT — COMPLETE SUPABASE DATABASE SETUP
-- Paste this entire file into your Supabase project's SQL Editor and click "RUN".
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

-- Category Rules Table (learned from user recategorisations)
create table if not exists public.category_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  merchant_pattern text not null,
  category_id uuid references public.categories on delete cascade,
  created_at timestamptz default now(),
  unique (user_id, merchant_pattern)
);

-- Recurring Payments Table
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

-- Flags Table (Review Flags - Neutral criteria, never "fraud")
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

-- Scenarios Table
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
-- 3. MUNIM AI COPILOT CHATBOT TABLES
-- ==============================================================================

-- Chat Conversations Table
create table if not exists public.chat_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  title text not null default 'New Conversation',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Chat Messages Table
create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  role text check (role in ('user','assistant')) not null,
  content text not null,
  sources jsonb default '[]'::jsonb,        -- [{type:'txn'|'calc'|'flag'|'recurring'|'goal', id, label}]
  tools_used jsonb default '[]'::jsonb,     -- [{name, args, duration_ms}]
  verified boolean default true,            -- did number verifier pass
  feedback smallint default 0 check (feedback in (-1, 0, 1)),
  tokens_in int default 0,
  tokens_out int default 0,
  created_at timestamptz default now()
);

-- Chat Proposals Table (Actions Munim proposes, requiring user confirmation)
create table if not exists public.chat_proposals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  message_id uuid references public.chat_messages on delete cascade,
  kind text not null check (kind in ('recategorise','create_goal','confirm_recurring','dismiss_flag')),
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending','applied','rejected','expired')),
  created_at timestamptz default now()
);

-- Chat Usage Table (Daily rate-limiting and token abuse prevention)
create table if not exists public.chat_usage (
  user_id uuid references auth.users on delete cascade,
  day date default current_date,
  tokens_in int default 0,
  tokens_out int default 0,
  requests int default 0,
  primary key (user_id, day)
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
create index if not exists idx_chat_messages_user on public.chat_messages (user_id, created_at desc);
create index if not exists idx_chat_proposals_user_status on public.chat_proposals (user_id, status);


-- ==============================================================================
-- 5. ROW LEVEL SECURITY (RLS) POLICIES
-- Scopes every table strictly to auth.uid()
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

-- CATEGORIES
drop policy if exists "categories_select" on public.categories;
create policy "categories_select" on public.categories for select using (auth.uid() = user_id);
drop policy if exists "categories_insert" on public.categories;
create policy "categories_insert" on public.categories for insert with check (auth.uid() = user_id);
drop policy if exists "categories_update" on public.categories;
create policy "categories_update" on public.categories for update using (auth.uid() = user_id);
drop policy if exists "categories_delete" on public.categories;
create policy "categories_delete" on public.categories for delete using (auth.uid() = user_id);

-- IMPORTS
drop policy if exists "imports_select" on public.imports;
create policy "imports_select" on public.imports for select using (auth.uid() = user_id);
drop policy if exists "imports_insert" on public.imports;
create policy "imports_insert" on public.imports for insert with check (auth.uid() = user_id);
drop policy if exists "imports_update" on public.imports;
create policy "imports_update" on public.imports for update using (auth.uid() = user_id);
drop policy if exists "imports_delete" on public.imports;
create policy "imports_delete" on public.imports for delete using (auth.uid() = user_id);

-- TRANSACTIONS
drop policy if exists "transactions_select" on public.transactions;
create policy "transactions_select" on public.transactions for select using (auth.uid() = user_id);
drop policy if exists "transactions_insert" on public.transactions;
create policy "transactions_insert" on public.transactions for insert with check (auth.uid() = user_id);
drop policy if exists "transactions_update" on public.transactions;
create policy "transactions_update" on public.transactions for update using (auth.uid() = user_id);
drop policy if exists "transactions_delete" on public.transactions;
create policy "transactions_delete" on public.transactions for delete using (auth.uid() = user_id);

-- CATEGORY RULES
drop policy if exists "category_rules_select" on public.category_rules;
create policy "category_rules_select" on public.category_rules for select using (auth.uid() = user_id);
drop policy if exists "category_rules_insert" on public.category_rules;
create policy "category_rules_insert" on public.category_rules for insert with check (auth.uid() = user_id);
drop policy if exists "category_rules_update" on public.category_rules;
create policy "category_rules_update" on public.category_rules for update using (auth.uid() = user_id);
drop policy if exists "category_rules_delete" on public.category_rules;
create policy "category_rules_delete" on public.category_rules for delete using (auth.uid() = user_id);

-- RECURRING PAYMENTS
drop policy if exists "recurring_select" on public.recurring_payments;
create policy "recurring_select" on public.recurring_payments for select using (auth.uid() = user_id);
drop policy if exists "recurring_insert" on public.recurring_payments;
create policy "recurring_insert" on public.recurring_payments for insert with check (auth.uid() = user_id);
drop policy if exists "recurring_update" on public.recurring_payments;
create policy "recurring_update" on public.recurring_payments for update using (auth.uid() = user_id);
drop policy if exists "recurring_delete" on public.recurring_payments;
create policy "recurring_delete" on public.recurring_payments for delete using (auth.uid() = user_id);

-- FLAGS
drop policy if exists "flags_select" on public.flags;
create policy "flags_select" on public.flags for select using (auth.uid() = user_id);
drop policy if exists "flags_insert" on public.flags;
create policy "flags_insert" on public.flags for insert with check (auth.uid() = user_id);
drop policy if exists "flags_update" on public.flags;
create policy "flags_update" on public.flags for update using (auth.uid() = user_id);
drop policy if exists "flags_delete" on public.flags;
create policy "flags_delete" on public.flags for delete using (auth.uid() = user_id);

-- GOALS
drop policy if exists "goals_select" on public.goals;
create policy "goals_select" on public.goals for select using (auth.uid() = user_id);
drop policy if exists "goals_insert" on public.goals;
create policy "goals_insert" on public.goals for insert with check (auth.uid() = user_id);
drop policy if exists "goals_update" on public.goals;
create policy "goals_update" on public.goals for update using (auth.uid() = user_id);
drop policy if exists "goals_delete" on public.goals;
create policy "goals_delete" on public.goals for delete using (auth.uid() = user_id);

-- SCENARIOS
drop policy if exists "scenarios_select" on public.scenarios;
create policy "scenarios_select" on public.scenarios for select using (auth.uid() = user_id);
drop policy if exists "scenarios_insert" on public.scenarios;
create policy "scenarios_insert" on public.scenarios for insert with check (auth.uid() = user_id);
drop policy if exists "scenarios_update" on public.scenarios;
create policy "scenarios_update" on public.scenarios for update using (auth.uid() = user_id);
drop policy if exists "scenarios_delete" on public.scenarios;
create policy "scenarios_delete" on public.scenarios for delete using (auth.uid() = user_id);

-- CHAT CONVERSATIONS
drop policy if exists "chat_conversations_select" on public.chat_conversations;
create policy "chat_conversations_select" on public.chat_conversations for select using (auth.uid() = user_id);
drop policy if exists "chat_conversations_insert" on public.chat_conversations;
create policy "chat_conversations_insert" on public.chat_conversations for insert with check (auth.uid() = user_id);
drop policy if exists "chat_conversations_update" on public.chat_conversations;
create policy "chat_conversations_update" on public.chat_conversations for update using (auth.uid() = user_id);
drop policy if exists "chat_conversations_delete" on public.chat_conversations;
create policy "chat_conversations_delete" on public.chat_conversations for delete using (auth.uid() = user_id);

-- CHAT MESSAGES
drop policy if exists "chat_messages_select" on public.chat_messages;
create policy "chat_messages_select" on public.chat_messages for select using (auth.uid() = user_id);
drop policy if exists "chat_messages_insert" on public.chat_messages;
create policy "chat_messages_insert" on public.chat_messages for insert with check (auth.uid() = user_id);
drop policy if exists "chat_messages_update" on public.chat_messages;
create policy "chat_messages_update" on public.chat_messages for update using (auth.uid() = user_id);
drop policy if exists "chat_messages_delete" on public.chat_messages;
create policy "chat_messages_delete" on public.chat_messages for delete using (auth.uid() = user_id);

-- CHAT PROPOSALS
drop policy if exists "chat_proposals_select" on public.chat_proposals;
create policy "chat_proposals_select" on public.chat_proposals for select using (auth.uid() = user_id);
drop policy if exists "chat_proposals_insert" on public.chat_proposals;
create policy "chat_proposals_insert" on public.chat_proposals for insert with check (auth.uid() = user_id);
drop policy if exists "chat_proposals_update" on public.chat_proposals;
create policy "chat_proposals_update" on public.chat_proposals for update using (auth.uid() = user_id);
drop policy if exists "chat_proposals_delete" on public.chat_proposals;
create policy "chat_proposals_delete" on public.chat_proposals for delete using (auth.uid() = user_id);

-- CHAT USAGE
drop policy if exists "chat_usage_all" on public.chat_usage;
create policy "chat_usage_all" on public.chat_usage for all using (auth.uid() = user_id) with check (auth.uid() = user_id);


-- ==============================================================================
-- 6. STORED PROCEDURES & TRIGGERS
-- ==============================================================================

-- Seed Default Categories for any new user (Google Auth, Email, or Anonymous)
create or replace function public.seed_default_categories(target_user_id uuid)
returns void as $$
begin
  insert into public.categories (user_id, name, kind, color) values
    (target_user_id, 'Salary', 'income', '#10B981'),
    (target_user_id, 'Other Income', 'income', '#34D399'),
    (target_user_id, 'Rent/Housing', 'expense', '#F59E0B'),
    (target_user_id, 'Groceries', 'expense', '#3B82F6'),
    (target_user_id, 'Dining', 'expense', '#EC4899'),
    (target_user_id, 'Transport', 'expense', '#8B5CF6'),
    (target_user_id, 'Utilities', 'expense', '#6366F1'),
    (target_user_id, 'Subscriptions', 'expense', '#F97316'),
    (target_user_id, 'Shopping', 'expense', '#14B8A6'),
    (target_user_id, 'Health', 'expense', '#EF4444'),
    (target_user_id, 'Entertainment', 'expense', '#A855F7'),
    (target_user_id, 'Travel', 'expense', '#06B6D4'),
    (target_user_id, 'Education', 'expense', '#4F46E5'),
    (target_user_id, 'Insurance', 'expense', '#64748B'),
    (target_user_id, 'Transfers', 'transfer', '#94A3B8'),
    (target_user_id, 'Uncategorised', 'expense', '#9CA3AF')
  on conflict (user_id, name) do nothing;
end;
$$ language plpgsql security definer;

-- Trigger: Automatically seed default categories when a new user signs up
create or replace function public.handle_new_user_categories()
returns trigger as $$
begin
  perform public.seed_default_categories(new.id);
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created_categories on auth.users;
create trigger on_auth_user_created_categories
  after insert on auth.users
  for each row execute function public.handle_new_user_categories();

-- Trigger: Automatically update updated_at timestamp on conversations
create or replace function public.update_chat_conversation_timestamp()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_chat_conversation_timestamp on public.chat_conversations;
create trigger trg_chat_conversation_timestamp
  before update on public.chat_conversations
  for each row execute function public.update_chat_conversation_timestamp();

-- Atomic Chat Usage Increment RPC Function
create or replace function public.increment_chat_usage(
  p_user_id uuid,
  p_day date,
  p_tokens_in int,
  p_tokens_out int
)
returns void as $$
begin
  insert into public.chat_usage (user_id, day, tokens_in, tokens_out, requests)
  values (p_user_id, p_day, p_tokens_in, p_tokens_out, 1)
  on conflict (user_id, day)
  do update set
    tokens_in = public.chat_usage.tokens_in + p_tokens_in,
    tokens_out = public.chat_usage.tokens_out + p_tokens_out,
    requests = public.chat_usage.requests + 1;
end;
$$ language plpgsql security definer;
