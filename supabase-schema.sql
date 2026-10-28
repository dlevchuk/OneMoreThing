-- ====================================================================
-- Схема бази даних Supabase для системи бронювання подарунків (OneMoreThing)
-- ====================================================================
-- Інструкція:
-- 1. Відкрий Supabase Dashboard (https://supabase.com/dashboard)
-- 2. Обери свій проект -> перейди в "SQL Editor"
-- 3. Натисни "New query", встав цей код і натисни "Run"
-- ====================================================================

-- 1. Створення таблиці reservations (Бронювання)
create table if not exists public.reservations (
  id uuid default gen_random_uuid() primary key,
  wish_id text not null unique,
  reserved_by text not null,
  note text,
  pin_code text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Коментарі для зручності
comment on table public.reservations is 'Таблиця заброньованих подарунків / контрактів';
comment on column public.reservations.wish_id is 'Унікальний ідентифікатор подарунка (з data/wishes.json)';
comment on column public.reservations.reserved_by is 'Імʼя або позивний того, хто забронював';
comment on column public.reservations.note is 'Коментар, контакт або привітання';
comment on column public.reservations.pin_code is '4-значний PIN для скасування бронювання';

-- 2. Налаштування Row Level Security (RLS)
alter table public.reservations enable row level security;

-- Дозволити всім (включно з анонімними гостями) читати статус бронювань
drop policy if exists "Дозволити публічне читання бронювань" on public.reservations;
create policy "Дозволити публічне читання бронювань"
  on public.reservations
  for select
  to anon, authenticated
  using (true);

-- Дозволити створювати нове бронювання
drop policy if exists "Дозволити створення нового бронювання" on public.reservations;
create policy "Дозволити створення нового бронювання"
  on public.reservations
  for insert
  to anon, authenticated
  with check (true);

-- 3. Безпечна функція для скасування бронювання (з перевіркою PIN)
create or replace function public.cancel_reservation(p_wish_id text, p_pin text default null)
returns boolean
language plpgsql
security definer
as $$
declare
  v_count integer;
begin
  delete from public.reservations
  where wish_id = p_wish_id
    and (
      pin_code is null 
      or pin_code = '' 
      or pin_code = p_pin
    );
  
  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$$;

-- Надаємо гостям право викликати функцію скасування
grant execute on function public.cancel_reservation(text, text) to anon, authenticated;

-- 4. Увімкнення Supabase Realtime (щоб картки оновлювалися в реальному часі без перезавантаження)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables 
    where pubname = 'supabase_realtime' and tablename = 'reservations'
  ) then
    alter publication supabase_realtime add table public.reservations;
  end if;
end;
$$;

