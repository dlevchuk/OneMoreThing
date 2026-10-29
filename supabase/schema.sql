-- ====================================================================
-- Схема Supabase для бронювання подарунків (OneMoreThing)
-- Ідемпотентна: працює і на чистому проєкті, і як міграція зі старої схеми.
-- Supabase Dashboard -> SQL Editor -> New query -> Run
-- ====================================================================

create extension if not exists pgcrypto with schema extensions;

-- 1. Публічна таблиця: лише те, що можна показувати всім
create table if not exists public.reservations (
  id uuid default gen_random_uuid() primary key,
  wish_id text not null unique,
  reserved_by text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 2. Приватна таблиця: хеш коду скасування + хеш IP для rate-limit.
--    RLS увімкнено, політик немає, прав для anon немає -> читає лише security definer.
create table if not exists public.reservation_secrets (
  wish_id text primary key references public.reservations(wish_id) on delete cascade,
  token_hash text,
  ip_hash text,
  created_at timestamp with time zone default now() not null
);
create index if not exists reservation_secrets_ip_idx
  on public.reservation_secrets (ip_hash, created_at);

alter table public.reservation_secrets enable row level security;
revoke all on public.reservation_secrets from anon, authenticated;

-- 3. Міграція зі старої схеми: pin_code -> хеш, прибрати pin_code і note.
--    Старі 4-значні PIN-и й далі працюють як "код скасування".
--    Старі броні без PIN лишаються з token_hash = null: зняти їх можна лише з дашборду.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'reservations' and column_name = 'pin_code'
  ) then
    insert into public.reservation_secrets (wish_id, token_hash)
    select wish_id,
           case when coalesce(pin_code, '') <> ''
                then encode(extensions.digest(pin_code, 'sha256'), 'hex') end
    from public.reservations
    on conflict (wish_id) do nothing;

    alter table public.reservations drop column pin_code;
  end if;
end;
$$;

alter table public.reservations drop column if exists note;

-- 4. RLS: читати можна всім, писати напряму — нікому (лише через RPC)
alter table public.reservations enable row level security;

drop policy if exists "Дозволити публічне читання бронювань" on public.reservations;
create policy "Дозволити публічне читання бронювань"
  on public.reservations for select to anon, authenticated using (true);

drop policy if exists "Дозволити створення нового бронювання" on public.reservations;
revoke insert, update, delete on public.reservations from anon, authenticated;

-- 5. Бронювання: валідація + rate-limit (5 броней/год з одного IP)
create or replace function public.reserve_gift(p_wish_id text, p_name text, p_token text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_name    text := btrim(coalesce(p_name, ''));
  v_token   text := upper(regexp_replace(coalesce(p_token, ''), '[^A-Za-z0-9]', '', 'g'));
  v_ip      text := btrim(split_part(
                      coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for', ''),
                      ',', 1));
  v_ip_hash text;
begin
  if char_length(v_name) not between 1 and 60 then
    raise exception 'invalid_name';
  end if;
  if char_length(coalesce(p_wish_id, '')) not between 1 and 100 then
    raise exception 'invalid_wish';
  end if;
  if v_token !~ '^[A-Z0-9]{4,32}$' then
    raise exception 'invalid_token';
  end if;

  if v_ip <> '' then
    v_ip_hash := encode(digest(v_ip, 'sha256'), 'hex');
    if (select count(*) from public.reservation_secrets
        where ip_hash = v_ip_hash and created_at > now() - interval '1 hour') >= 5 then
      raise exception 'rate_limited';
    end if;
  end if;

  -- дубль wish_id дасть 23505, клієнт це обробляє
  insert into public.reservations (wish_id, reserved_by) values (p_wish_id, v_name);
  insert into public.reservation_secrets (wish_id, token_hash, ip_hash)
  values (p_wish_id, encode(digest(v_token, 'sha256'), 'hex'), v_ip_hash);
end;
$$;

revoke all on function public.reserve_gift(text, text, text) from public;
grant execute on function public.reserve_gift(text, text, text) to anon, authenticated;

-- 6. Скасування: лише з правильним кодом (броні без коду — тільки з дашборду)
drop function if exists public.cancel_reservation(text, text);

create or replace function public.cancel_reservation(p_wish_id text, p_token text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_token text := upper(regexp_replace(coalesce(p_token, ''), '[^A-Za-z0-9]', '', 'g'));
  v_count integer;
begin
  if v_token = '' then
    return false;
  end if;

  delete from public.reservations r
  using public.reservation_secrets s
  where r.wish_id = p_wish_id
    and s.wish_id = r.wish_id
    and s.token_hash = encode(digest(v_token, 'sha256'), 'hex');

  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$$;

revoke all on function public.cancel_reservation(text, text) from public;
grant execute on function public.cancel_reservation(text, text) to anon, authenticated;

-- 7. Realtime
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