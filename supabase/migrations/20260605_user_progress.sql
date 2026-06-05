create table if not exists public.user_progress (
  user_id uuid not null,
  item_type text not null check (item_type in ('pyq', 'relevant_question', 'topper_copy')),
  item_id text not null,
  done boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, item_type, item_id)
);

alter table public.user_progress enable row level security;

drop policy if exists "user_progress_select_own" on public.user_progress;
create policy "user_progress_select_own"
  on public.user_progress
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "user_progress_insert_own" on public.user_progress;
create policy "user_progress_insert_own"
  on public.user_progress
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "user_progress_update_own" on public.user_progress;
create policy "user_progress_update_own"
  on public.user_progress
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
