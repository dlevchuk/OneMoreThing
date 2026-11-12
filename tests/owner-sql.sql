-- Disposable database only; rollback preserves the fixture.
begin;
insert into auth.users(id) values('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002');
insert into private.site_owners(user_id) values('00000000-0000-0000-0000-000000000001');
select set_config('omt.test_wish', (select wish_id from public.gift_catalog where active limit 1), true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
set local role authenticated;
do $$ begin
  if public.is_site_owner() then raise exception 'Nonowner authorized'; end if;
  begin
    perform public.set_gift_completed(current_setting('omt.test_wish'), true, 'injected');
    raise exception 'Nonowner mutation allowed';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
truncate public.reservations cascade;
truncate public.reservation_attempts;
select public.reserve_gift(current_setting('omt.test_wish'), 'guest', '0123456789AB');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select public.set_gift_completed(current_setting('omt.test_wish'), true, 'Thank you');
do $$ begin
  if not exists(select 1 from public.gift_catalog where wish_id=current_setting('omt.test_wish') and completed_at is not null and completion_note='Thank you') then raise exception 'Completion missing'; end if;
  if exists(select 1 from public.reservations where wish_id=current_setting('omt.test_wish')) then raise exception 'Reservation not closed'; end if;
  begin
    perform public.reserve_gift(current_setting('omt.test_wish'), 'attacker', '0123456789AB');
    raise exception 'Completed gift reserved';
  exception when others then if sqlerrm <> 'gift_completed' then raise; end if;
  end;
  if public.cancel_reservation(current_setting('omt.test_wish'),'0123456789AB') then raise exception 'Old token still valid'; end if;
end $$;
select public.set_gift_completed(current_setting('omt.test_wish'), false, '');
do $$ begin
  if exists(select 1 from public.gift_catalog where wish_id=current_setting('omt.test_wish') and completed_at is not null) then raise exception 'Reopen failed'; end if;
  if exists(select 1 from public.reservations where wish_id=current_setting('omt.test_wish')) then raise exception 'Old reservation resurrected'; end if;
end $$;
select public.reserve_gift(current_setting('omt.test_wish'), 'new guest', 'ABCDEFGHIJKL');
-- A repeated stale reopen must not cancel a new guest's reservation.
select public.set_gift_completed(current_setting('omt.test_wish'), false, '');
do $$ begin
  if not exists(select 1 from public.reservations where wish_id=current_setting('omt.test_wish')) then raise exception 'Repeated reopen canceled new reservation'; end if;
end $$;
reset role;
do $$ begin
  if exists(select 1 from public.reservation_secrets where wish_id=current_setting('omt.test_wish') and token_hash=encode(extensions.digest('0123456789AB','sha256'),'hex')) then raise exception 'Old secret resurrected'; end if;
end $$;
rollback;
