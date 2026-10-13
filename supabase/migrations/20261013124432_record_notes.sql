-- The service record: three things put right after a second look
--
--   1. What command writes on an appointment, and what an instructor writes on
--      an award, was sent to every serving member with the row it sits on. It
--      is now for staff. An appointment's note is read from its own table,
--      which only staff are sent. An award's note is no longer sent to anyone.
--
--   2. Putting right the grade of a post that has already been left wrote a
--      promotion dated today. It now corrects the post's last line.
--
--   3. The record's days were the day in whatever time zone the request asked
--      for. They are now the day in UTC, as everywhere else on the record.

-- ---------------------------------------------------------------------------
-- The note on an appointment
-- ---------------------------------------------------------------------------

-- A copy of each appointment's note, kept by the database. The note is still
-- written on the appointment, where it can no longer be read through the API.
create table public.assignment_notes (
  assignment_id uuid primary key references public.assignments (id) on delete cascade,
  member_id uuid not null references public.members (id) on delete cascade,
  note text not null
);
create index assignment_notes_member_idx on public.assignment_notes (member_id);

create function app.keep_assignment_note() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.note <> '' then
    insert into public.assignment_notes (assignment_id, member_id, note)
    values (new.id, new.member_id, new.note)
    on conflict (assignment_id) do update set note = excluded.note;
  else
    -- A note that was taken off is kept as an empty one.
    update public.assignment_notes set note = '' where assignment_id = new.id;
  end if;
  return new;
end;
$$;

create trigger assignments_note_kept after insert or update of note on public.assignments
  for each row execute function app.keep_assignment_note();

insert into public.assignment_notes (assignment_id, member_id, note)
select id, member_id, note from public.assignments where note <> '';

-- ---------------------------------------------------------------------------
-- A grade put right after the post was left
-- ---------------------------------------------------------------------------

create or replace function app.record_assignment_grade() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  -- A duty carries no grade.
  if new.kind <> 'primary' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    insert into public.assignment_grades (assignment_id, member_id, grade_code, acting, since, set_by)
    values (new.id, new.member_id, new.grade_code, new.acting, new.started_on, new.appointed_by);
  elsif new.grade_code is distinct from old.grade_code or new.acting is distinct from old.acting then
    if old.ended_on is not null then
      -- The post is history. Only the database's owner can change it, to put a
      -- mistake right, and that is a correction to its last line, not a
      -- promotion made today.
      update public.assignment_grades g
      set grade_code = new.grade_code, acting = new.acting
      where g.id = (
        select l.id from public.assignment_grades l
        where l.assignment_id = new.id order by l.id desc limit 1
      );
    else
      insert into public.assignment_grades (assignment_id, member_id, grade_code, acting, set_by)
      values (new.id, new.member_id, new.grade_code, new.acting,
              (select m.id from public.members m where m.id = (select auth.uid())));
    end if;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- The record's days are days in UTC
-- ---------------------------------------------------------------------------

alter table public.member_status_changes
  alter column changed_on set default ((now() at time zone 'utc')::date);
alter table public.assignment_grades
  alter column since set default ((now() at time zone 'utc')::date);

-- ---------------------------------------------------------------------------
-- Privileges: nothing by default, then only what each rule needs
-- ---------------------------------------------------------------------------

grant all on public.assignment_notes to service_role;
grant select on public.assignment_notes to authenticated;

-- Every column of an appointment but its note.
revoke select on public.assignments from authenticated;
grant select (id, member_id, position_id, kind, grade_code, acting, started_on, ended_on, appointed_by, recorded_at)
  on public.assignments to authenticated;

-- Every column of an award but its note.
revoke select on public.qualification_awards from authenticated;
grant select (id, member_id, qualification_id, awarded_by, awarded_on, event_id)
  on public.qualification_awards to authenticated;

-- ---------------------------------------------------------------------------
-- Access rules
-- ---------------------------------------------------------------------------

alter table public.assignment_notes enable row level security;

create policy "Staff read the note on an appointment" on public.assignment_notes
  for select to authenticated
  using ((select app.is_staff()));
