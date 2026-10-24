-- ==============================================================================
-- FinPilot Supabase Schema with Row Level Security (RLS) & Default Categories
-- ==============================================================================

-- 1. Enable pgcrypto for UUID generation if not present
create extension if not exists "pgcrypto";

-- 2. CATEGORIES TABLE
create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  name text not null,
  kind text check (kind in ('income','expense','transfer')) not null,
  color text,
  created_at timestamptz default now(),
  unique (user_id, name)
);

-- 3. IMPORTS TABLE
create table if not exists imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  filename text,
  is_sample boolean default false,
  row_count int default 0,
  total_in numeric(14,2) default 0,
  total_out numeric(14,2) default 0,
  created_at timestamptz default now()
);

-- 4. TRANSACTIONS TABLE
create table if not exists transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  import_id uuid references imports on delete cascade,
  txn_date date not null,
  description text not null,
  merchant text,
  amount numeric(14,2) not null,            -- negative = outflow, positive = inflow
  category_id uuid references categories on delete set null,
  category_source text default 'auto' check (category_source in ('auto','user')),
  is_sample boolean default false,
  hash text,                                -- dedupe: date+amount+description
  created_at timestamptz default now(),
  unique (user_id, hash)
);

-- 5. CATEGORY RULES TABLE (learned from user corrections)
create table if not exists category_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  merchant_pattern text not null,
  category_id uuid references categories on delete cascade,
  created_at timestamptz default now(),
  unique (user_id, merchant_pattern)
);

-- 6. RECURRING PAYMENTS TABLE
create table if not exists recurring_payments (
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

-- 7. FLAGS TABLE (Unusual Activity Flagged for Review)
create table if not exists flags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  txn_id uuid references transactions on delete cascade,
  reason_code text not null,
  reason_text text not null,
  score numeric(5,2),
  status text default 'open' check (status in ('open','normal','dismissed','follow_up')),
  created_at timestamptz default now()
);

-- 8. GOALS TABLE
create table if not exists goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  name text not null,
  target_amount numeric(14,2) not null,
  current_amount numeric(14,2) default 0,
  target_date date,
  created_at timestamptz default now()
);

-- 9. SCENARIOS TABLE
create table if not exists scenarios (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  goal_id uuid references goals on delete set null,
  name text not null,
  params jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz default now()
);

-- 10. CHAT MESSAGES TABLE
create table if not exists chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  role text check (role in ('user','assistant')) not null,
  content text not null,
  sources jsonb default '[]'::jsonb,
  created_at timestamptz default now()
);

-- ==============================================================================
-- INDEXES FOR OPTIMAL QUERY PERFORMANCE
-- ==============================================================================
create index if not exists idx_transactions_user_date on transactions (user_id, txn_date desc);
create index if not exists idx_transactions_category on transactions (category_id);
create index if not exists idx_transactions_hash on transactions (user_id, hash);
create index if not exists idx_recurring_user on recurring_payments (user_id);
create index if not exists idx_flags_user_status on flags (user_id, status);
create index if not exists idx_rules_user_pattern on category_rules (user_id, merchant_pattern);

-- ==============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ==============================================================================
alter table categories enable row level security;
alter table imports enable row level security;
alter table transactions enable row level security;
alter table category_rules enable row level security;
alter table recurring_payments enable row level security;
alter table flags enable row level security;
alter table goals enable row level security;
alter table scenarios enable row level security;
alter table chat_messages enable row level security;

-- CATEGORIES RLS
create policy "Users can view own categories" on categories for select using (auth.uid() = user_id);
create policy "Users can insert own categories" on categories for insert with check (auth.uid() = user_id);
create policy "Users can update own categories" on categories for update using (auth.uid() = user_id);
create policy "Users can delete own categories" on categories for delete using (auth.uid() = user_id);

-- IMPORTS RLS
create policy "Users can view own imports" on imports for select using (auth.uid() = user_id);
create policy "Users can insert own imports" on imports for insert with check (auth.uid() = user_id);
create policy "Users can update own imports" on imports for update using (auth.uid() = user_id);
create policy "Users can delete own imports" on imports for delete using (auth.uid() = user_id);

-- TRANSACTIONS RLS
create policy "Users can view own transactions" on transactions for select using (auth.uid() = user_id);
create policy "Users can insert own transactions" on transactions for insert with check (auth.uid() = user_id);
create policy "Users can update own transactions" on transactions for update using (auth.uid() = user_id);
create policy "Users can delete own transactions" on transactions for delete using (auth.uid() = user_id);

-- CATEGORY RULES RLS
create policy "Users can view own category rules" on category_rules for select using (auth.uid() = user_id);
create policy "Users can insert own category rules" on category_rules for insert with check (auth.uid() = user_id);
create policy "Users can update own category rules" on category_rules for update using (auth.uid() = user_id);
create policy "Users can delete own category rules" on category_rules for delete using (auth.uid() = user_id);

-- RECURRING PAYMENTS RLS
create policy "Users can view own recurring payments" on recurring_payments for select using (auth.uid() = user_id);
create policy "Users can insert own recurring payments" on recurring_payments for insert with check (auth.uid() = user_id);
create policy "Users can update own recurring payments" on recurring_payments for update using (auth.uid() = user_id);
create policy "Users can delete own recurring payments" on recurring_payments for delete using (auth.uid() = user_id);

-- FLAGS RLS
create policy "Users can view own flags" on flags for select using (auth.uid() = user_id);
create policy "Users can insert own flags" on flags for insert with check (auth.uid() = user_id);
create policy "Users can update own flags" on flags for update using (auth.uid() = user_id);
create policy "Users can delete own flags" on flags for delete using (auth.uid() = user_id);

-- GOALS RLS
create policy "Users can view own goals" on goals for select using (auth.uid() = user_id);
create policy "Users can insert own goals" on goals for insert with check (auth.uid() = user_id);
create policy "Users can update own goals" on goals for update using (auth.uid() = user_id);
create policy "Users can delete own goals" on goals for delete using (auth.uid() = user_id);

-- SCENARIOS RLS
create policy "Users can view own scenarios" on scenarios for select using (auth.uid() = user_id);
create policy "Users can insert own scenarios" on scenarios for insert with check (auth.uid() = user_id);
create policy "Users can update own scenarios" on scenarios for update using (auth.uid() = user_id);
create policy "Users can delete own scenarios" on scenarios for delete using (auth.uid() = user_id);

-- CHAT MESSAGES RLS
create policy "Users can view own chat messages" on chat_messages for select using (auth.uid() = user_id);
create policy "Users can insert own chat messages" on chat_messages for insert with check (auth.uid() = user_id);
create policy "Users can update own chat messages" on chat_messages for update using (auth.uid() = user_id);
create policy "Users can delete own chat messages" on chat_messages for delete using (auth.uid() = user_id);

-- ==============================================================================
-- AUTOMATIC CATEGORY SEEDING FOR NEW USERS
-- ==============================================================================

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

-- Trigger to automatically seed categories on new auth.users signup
create or replace function public.handle_new_user_categories()
returns trigger as $$
begin
  perform public.seed_default_categories(new.id);
  return new;
end;
$$ language plpgsql security definer;

-- Drop trigger if it already exists then attach to auth.users
drop trigger if exists on_auth_user_created_categories on auth.users;
create trigger on_auth_user_created_categories
  after insert on auth.users
  for each row execute function public.handle_new_user_categories();

-- ==============================================================================
-- INSTRUCTIONS FOR SUPABASE DASHBOARD:
-- 1. Enable Anonymous Sign-ins:
--    Go to Authentication -> Providers -> Anonymous -> Enable.
-- 2. Paste this entire file into the Supabase SQL Editor and execute.
-- ==============================================================================
