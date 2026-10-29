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

-- 2. Приватна таблиця: хеш коду скасування.
--    RLS увімкнено, політик немає, прав для anon немає -> читає лише security definer.
create table if not exists public.reservation_secrets (
  wish_id text primary key references public.reservations(wish_id) on delete cascade,
  token_hash text,
  ip_hash text,
  created_at timestamp with time zone default now() not null
);

alter table public.reservation_secrets enable row level security;
revoke all on public.reservation_secrets from anon, authenticated;

-- 2b. Журнал спроб для rate-limit. НЕ повʼязаний каскадом з бронями,
--     тому цикл reserve -> cancel ліміт не скидає.
create table if not exists public.reservation_attempts (
  id bigint generated always as identity primary key,
  bucket text not null,
  created_at timestamp with time zone default now() not null
);
create index if not exists reservation_attempts_bucket_idx
  on public.reservation_attempts (bucket, created_at);

alter table public.reservation_attempts enable row level security;
revoke all on public.reservation_attempts from anon, authenticated;

-- 3. Міграція зі старої схеми: pin_code -> хеш, прибрати pin_code і note.
--    Старі 4-значні PIN-и й далі працюють як "код скасування" (тепер під ліміт спроб).
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

-- 5. Хелпери (недоступні через API: тільки для інших security definer функцій)

-- Хеш IP клієнта. Порядок: cf-connecting-ip (Cloudflare перезаписує підробку)
-- -> x-real-ip -> ОСТАННІЙ елемент x-forwarded-for (його дописує проксі, а не клієнт).
-- Якщо IP не знайдено -> null (тоді діє лише глобальний ліміт).
create or replace function public._request_ip_hash()
returns text
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_headers json := nullif(current_setting('request.headers', true), '')::json;
  v_ip text;
begin
  v_ip := btrim(coalesce(
    v_headers ->> 'cf-connecting-ip',
    v_headers ->> 'x-real-ip',
    (regexp_match(coalesce(v_headers ->> 'x-forwarded-for', ''), '([^,\s]+)\s*$'))[1],
    ''
  ));
  if v_ip = '' then
    return null;
  end if;
  return encode(digest(v_ip, 'sha256'), 'hex');
end;
$$;

create or replace function public._attempts_since(p_bucket text, p_window interval)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int
  from public.reservation_attempts
  where bucket = p_bucket and created_at > now() - p_window;
$$;

revoke all on function public._request_ip_hash() from public, anon, authenticated;
revoke all on function public._attempts_since(text, interval) from public, anon, authenticated;

-- 6. Бронювання: валідація + rate-limit
--    5 броней/год з IP, 40/год глобально, максимум 200 активних броней.
create or replace function public.reserve_gift(p_wish_id text, p_name text, p_token text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_name    text := btrim(coalesce(p_name, ''));
  v_token   text := upper(regexp_replace(coalesce(p_token, ''), '[^A-Za-z0-9]', '', 'g'));
  v_ip_hash text := public._request_ip_hash();
begin
  if char_length(v_name) not between 1 and 60 then
    raise exception 'invalid_name';
  end if;
  if coalesce(p_wish_id, '') !~ '^[A-Za-z0-9_-]{1,100}$' then
    raise exception 'invalid_wish';
  end if;
  if v_token !~ '^[A-Z0-9]{4,32}$' then
    raise exception 'invalid_token';
  end if;

  -- прибирання старого журналу
  delete from public.reservation_attempts where created_at < now() - interval '1 day';

  if public._attempts_since('reserve:global', interval '1 hour') >= 40 then
    raise exception 'rate_limited';
  end if;
  if v_ip_hash is not null
     and public._attempts_since('reserve:ip:' || v_ip_hash, interval '1 hour') >= 5 then
    raise exception 'rate_limited';
  end if;
  if (select count(*) from public.reservations) >= 200 then
    raise exception 'too_many';
  end if;

  insert into public.reservation_attempts (bucket) values ('reserve:global');
  if v_ip_hash is not null then
    insert into public.reservation_attempts (bucket) values ('reserve:ip:' || v_ip_hash);
  end if;

  -- дубль wish_id дасть 23505, клієнт це обробляє
  insert into public.reservations (wish_id, reserved_by) values (p_wish_id, v_name);
  insert into public.reservation_secrets (wish_id, token_hash, ip_hash)
  values (p_wish_id, encode(digest(v_token, 'sha256'), 'hex'), v_ip_hash);
end;
$$;

revoke all on function public.reserve_gift(text, text, text) from public;
grant execute on function public.reserve_gift(text, text, text) to anon, authenticated;

-- 7. Скасування: лише з правильним кодом (броні без коду — тільки з дашборду).
--    Невдалі спроби журналяться: 10/год на бронь, 20/год з IP.
--    Невдача = return false (не exception), щоб запис про спробу не відкотився.
drop function if exists public.cancel_reservation(text, text);

create or replace function public.cancel_reservation(p_wish_id text, p_token text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_token   text := upper(regexp_replace(coalesce(p_token, ''), '[^A-Za-z0-9]', '', 'g'));
  v_wish    text := left(coalesce(p_wish_id, ''), 100);
  v_ip_hash text := public._request_ip_hash();
  v_count   integer;
begin
  if v_token = '' or v_wish = '' then
    return false;
  end if;

  if public._attempts_since('cancel:wish:' || v_wish, interval '1 hour') >= 10 then
    raise exception 'rate_limited';
  end if;
  if v_ip_hash is not null
     and public._attempts_since('cancel:ip:' || v_ip_hash, interval '1 hour') >= 20 then
    raise exception 'rate_limited';
  end if;

  delete from public.reservations r
  using public.reservation_secrets s
  where r.wish_id = v_wish
    and s.wish_id = r.wish_id
    and s.token_hash = encode(digest(v_token, 'sha256'), 'hex');

  get diagnostics v_count = row_count;
  if v_count > 0 then
    return true;
  end if;

  insert into public.reservation_attempts (bucket) values ('cancel:wish:' || v_wish);
  if v_ip_hash is not null then
    insert into public.reservation_attempts (bucket) values ('cancel:ip:' || v_ip_hash);
  end if;
  return false;
end;
$$;

revoke all on function public.cancel_reservation(text, text) from public;
grant execute on function public.cancel_reservation(text, text) to anon, authenticated;

-- 8. Realtime
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