-- Clear away the old fixed list of event kinds.
--
-- Types of event have been records an admin keeps since the event types
-- migration. The old list (the type public.event_kind) and the helper that
-- read it were left in place, unused, because removing them is a deletion and
-- the database's owner confirms those. Nothing reads either of them: no
-- column, no rule and no other function.
--
-- Neither statement has "cascade", so if anything did still use one of them
-- the database would refuse, and nothing else would be removed with it.

drop function app.may_create_event(public.event_kind);
drop type public.event_kind;
