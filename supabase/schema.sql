-- ====================================================================
-- Схема Supabase для бронювання подарунків (OneMoreThing)
-- Ідемпотентна: працює і на чистому проєкті, і як міграція зі старої схеми.
-- Supabase Dashboard -> SQL Editor -> New query -> Run
-- ====================================================================

begin;

create extension if not exists pgcrypto with schema extensions;

-- Каталог змінює лише власник БД. Генерується з data/wishes.json.
create table if not exists public.gift_catalog (
  wish_id text primary key,
  active boolean not null default true
);
alter table public.gift_catalog enable row level security;
revoke all on public.gift_catalog from public, anon, authenticated;
alter table public.gift_catalog add column if not exists completed_at timestamptz;
alter table public.gift_catalog add column if not exists completion_note text not null default '';
grant select (wish_id, active, completed_at, completion_note) on public.gift_catalog to anon, authenticated;
drop policy if exists "Public gift status" on public.gift_catalog;
create policy "Public gift status" on public.gift_catalog for select to anon, authenticated using (active);

-- UUID власника додається адміністратором після створення Auth-користувача.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table if not exists private.site_owners (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table private.site_owners enable row level security;
revoke all on private.site_owners from public, anon, authenticated;

create or replace function public.is_site_owner()
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from private.site_owners where user_id = auth.uid()); $$;
revoke all on function public.is_site_owner() from public;
grant execute on function public.is_site_owner() to anon, authenticated;

create or replace function public.set_gift_completed(p_wish_id text, p_completed boolean, p_note text default '')
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_site_owner() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_completed is null or char_length(coalesce(p_note, '')) > 500 then raise exception 'invalid_status'; end if;
  perform pg_catalog.pg_advisory_xact_lock(1869440817, 1);
  if not exists (select 1 from public.gift_catalog where wish_id = p_wish_id and active) then
    raise exception 'invalid_wish';
  end if;
  update public.gift_catalog
  set completed_at = case when p_completed then coalesce(completed_at, pg_catalog.clock_timestamp()) else null end,
      completion_note = case when p_completed then btrim(coalesce(p_note, '')) else '' end
  where wish_id = p_wish_id;
  -- Секрет бронювання видаляється каскадно. Повернення у вільні його не відновить.
  delete from public.reservations where wish_id = p_wish_id and p_completed;
end;
$$;
revoke all on function public.set_gift_completed(text, boolean, text) from public, anon;
grant execute on function public.set_gift_completed(text, boolean, text) to authenticated;

-- BEGIN GENERATED GIFT CATALOG
update public.gift_catalog set active = false;
insert into public.gift_catalog (wish_id, active) values
  ('baseus-air-car-jump-starter-super-energy-10000mah', true),
  ('xiaomi-portable-electric-air-compressor-2-pro', true),
  ('orpro-dynamic-recovery-8t-9m', true),
  ('hidratespark-pro-2-32oz', true),
  ('oura-ring-5', true),
  ('arzopa-a1s-14-portable-monitor', true),
  ('radiomaster-tx15-max-elrs-m2', true),
  ('bambu-lab-a1-mini', true),
  ('jelly-bar-berry-gin', true),
  ('steam-deck-oled', true),
  ('ubiquiti-dream-router-5g-max', true),
  ('whisky-stones-gift-set-rozetka', true),
  ('herman-miller-aeron-office-chair', true),
  ('uniqlo-pufftech-parka-navy', true)
on conflict (wish_id) do update set active = excluded.active;
-- END GENERATED GIFT CATALOG

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
alter table public.reservation_attempts alter column created_at set default clock_timestamp();
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
grant select on public.reservations to anon, authenticated;

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
volatile
security definer
set search_path = public
as $$
  select count(*)::int
  from public.reservation_attempts
  where bucket = p_bucket and created_at > clock_timestamp() - p_window;
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
  if v_token !~ '^[A-Z0-9]{12,32}$' then
    raise exception 'invalid_token';
  end if;

  -- Обидва RPC беруть один lock до читання лімітів і тримають до commit.
  -- VOLATILE _attempts_since читає свіжий snapshot після очікування lock.
  perform pg_advisory_xact_lock(1869440817, 1);
  if not exists (select 1 from public.gift_catalog where wish_id = p_wish_id and active) then
    raise exception 'invalid_wish';
  end if;

  if exists (select 1 from public.gift_catalog where wish_id = p_wish_id and completed_at is not null) then
    raise exception 'gift_completed';
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
  if (select count(*) from public.reservations r
      join public.gift_catalog g on g.wish_id = r.wish_id where g.active) >= 200 then
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
  v_wish    text := coalesce(p_wish_id, '');
  v_ip_hash text := public._request_ip_hash();
  v_count   integer;
begin
  if v_token !~ '^[A-Z0-9]{4,32}$' or v_wish !~ '^[A-Za-z0-9_-]{1,100}$' then
    return false;
  end if;

  perform pg_advisory_xact_lock(1869440817, 1);
  delete from public.reservation_attempts where created_at < clock_timestamp() - interval '1 day';
  -- Вигадані ID не створюють нові buckets у журналі.
  if not exists (select 1 from public.reservations where wish_id = v_wish) then
    return false;
  end if;
  if public._attempts_since('cancel:global', interval '1 hour') >= 200 then
    raise exception 'rate_limited';
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
  insert into public.reservation_attempts (bucket) values ('cancel:global');
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
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'gift_catalog'
  ) then
    alter publication supabase_realtime add table public.gift_catalog;
  end if;
end;
$$;

commit;
