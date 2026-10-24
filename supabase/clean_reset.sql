-- ==============================================================================
-- FINPILOT — CLEAN SLATE RESET SCRIPT
-- Run this in Supabase SQL Editor to wipe out old dummy/test records.
-- It keeps all tables and schemas intact, so your app is completely fresh!
-- ==============================================================================

-- 1. Wipe all user financial transactions, goals, flags, and imports
truncate table public.transactions, 
               public.goals, 
               public.flags, 
               public.recurring_payments, 
               public.imports, 
               public.category_rules, 
               public.scenarios, 
               public.chat_messages, 
               public.chat_proposals, 
               public.chat_conversations, 
               public.chat_usage cascade;

-- 2. (Optional) To also delete dummy/test users from auth.users:
-- Go to Supabase Dashboard -> Authentication -> Users -> Select test users -> Delete.
