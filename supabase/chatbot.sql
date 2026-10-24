-- supabase/chatbot.sql
-- Munim AI Chatbot Database Schema for FinPilot
-- Complete with Row Level Security (RLS) policies scoped strictly to auth.uid()

-- 1. CHAT CONVERSATIONS TABLE
create table if not exists chat_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  title text not null default 'New Conversation',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Enable RLS
alter table chat_conversations enable row level security;

-- Policies for chat_conversations
create policy "Users can select own chat conversations"
  on chat_conversations for select
  using (auth.uid() = user_id);

create policy "Users can insert own chat conversations"
  on chat_conversations for insert
  with check (auth.uid() = user_id);

create policy "Users can update own chat conversations"
  on chat_conversations for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own chat conversations"
  on chat_conversations for delete
  using (auth.uid() = user_id);


-- 2. CHAT MESSAGES TABLE
create table if not exists chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references chat_conversations on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  role text check (role in ('user','assistant')) not null,
  content text not null,
  sources jsonb default '[]'::jsonb,        -- [{type:'txn'|'calc'|'flag'|'recurring'|'goal', id, label}]
  tools_used jsonb default '[]'::jsonb,     -- [{name, args, duration_ms}]
  verified boolean default true,            -- did the number verifier pass
  feedback smallint default 0 check (feedback in (-1, 0, 1)), -- -1 dislike, 0 none, 1 like
  tokens_in int default 0,
  tokens_out int default 0,
  created_at timestamptz default now()
);

-- Enable RLS
alter table chat_messages enable row level security;

-- Policies for chat_messages
create policy "Users can select own chat messages"
  on chat_messages for select
  using (auth.uid() = user_id);

create policy "Users can insert own chat messages"
  on chat_messages for insert
  with check (auth.uid() = user_id);

create policy "Users can update own chat messages"
  on chat_messages for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own chat messages"
  on chat_messages for delete
  using (auth.uid() = user_id);

-- Performance Indexes
create index if not exists idx_chat_messages_conv_created 
  on chat_messages(conversation_id, created_at asc);

create index if not exists idx_chat_messages_user_created 
  on chat_messages(user_id, created_at desc);


-- 3. CHAT PROPOSALS TABLE (Suggested actions requiring user confirmation)
create table if not exists chat_proposals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  message_id uuid references chat_messages on delete cascade,
  kind text not null check (kind in ('recategorise','create_goal','confirm_recurring','dismiss_flag')),
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending','applied','rejected','expired')),
  created_at timestamptz default now()
);

-- Enable RLS
alter table chat_proposals enable row level security;

-- Policies for chat_proposals
create policy "Users can select own chat proposals"
  on chat_proposals for select
  using (auth.uid() = user_id);

create policy "Users can insert own chat proposals"
  on chat_proposals for insert
  with check (auth.uid() = user_id);

create policy "Users can update own chat proposals"
  on chat_proposals for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own chat proposals"
  on chat_proposals for delete
  using (auth.uid() = user_id);

create index if not exists idx_chat_proposals_user_status 
  on chat_proposals(user_id, status);


-- 4. CHAT USAGE TABLE (Cost, abuse prevention, and rate quotas)
create table if not exists chat_usage (
  user_id uuid references auth.users on delete cascade,
  day date default current_date,
  tokens_in int default 0,
  tokens_out int default 0,
  requests int default 0,
  primary key (user_id, day)
);

-- Enable RLS
alter table chat_usage enable row level security;

-- Policies for chat_usage
create policy "Users can view own usage"
  on chat_usage for select
  using (auth.uid() = user_id);

create policy "Users can insert/update own usage"
  on chat_usage for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Auto updated_at timestamp trigger for conversations
create or replace function update_chat_conversation_timestamp()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_chat_conversation_timestamp on chat_conversations;
create trigger trg_chat_conversation_timestamp
  before update on chat_conversations
  for each row execute function update_chat_conversation_timestamp();
