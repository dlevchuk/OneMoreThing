-- Run against a disposable database after schema.sql, as its owner.
begin;
truncate public.reservations cascade;
truncate public.reservation_attempts;

do $$
declare
  v_wish text := (select wish_id from public.gift_catalog where active limit 1);
  v_failed boolean := false;
begin
  begin
    perform public.reserve_gift('not-in-catalog', 'tester', '0123456789AB');
  exception when others then
    if sqlerrm <> 'invalid_wish' then raise; end if;
    v_failed := true;
  end;
  if not v_failed then raise exception 'Unknown gift accepted'; end if;
  v_failed := false;
  begin
    perform public.reserve_gift(v_wish, 'tester', '1234');
  exception when others then
    if sqlerrm <> 'invalid_token' then raise; end if;
    v_failed := true;
  end;
  if not v_failed then raise exception 'Weak new token accepted'; end if;
  perform public.reserve_gift(v_wish, 'tester', '0123-4567-89ab');
  if public.cancel_reservation(v_wish, '9999') then raise exception 'Wrong token accepted'; end if;
  if not public.cancel_reservation(v_wish, '0123-4567-89AB') then raise exception 'Valid token rejected'; end if;
  -- Existing legacy PINs must remain usable.
  insert into public.reservations(wish_id,reserved_by) values(v_wish,'legacy');
  insert into public.reservation_secrets(wish_id,token_hash)
    values(v_wish,encode(extensions.digest('1234','sha256'),'hex'));
  if not public.cancel_reservation(v_wish,'1234') then raise exception 'Legacy PIN rejected'; end if;
  if public.cancel_reservation(repeat('x',101),'1234') then raise exception 'Long ID accepted'; end if;
  if public.cancel_reservation('missing','1234') then raise exception 'Missing reservation canceled'; end if;
end;
$$;
set local role anon;
do $$
begin
  begin
    update public.gift_catalog set completed_at = now();
    raise exception 'Catalog writable';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.reservations(wish_id,reserved_by) values('injected','attacker');
    raise exception 'Direct insert accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.reservation_secrets;
    raise exception 'Tokens exposed';
  exception when insufficient_privilege then null;
  end;
end;
$$;
rollback;
