-- UEE 9th Fleet: visitors can read the structure.
--
-- The public site lists the fleet's roles: which units and posts exist, the
-- grade each carries, the stage it opens at and the qualifications it needs.
-- None of that names a person, and Volume 1 of the manual publishes the same
-- structure in words.
--
-- Nothing about people changes here. Members, accounts, roles, appointments,
-- qualification awards, applications, interview notes and the audit log keep
-- the rules the core schema gave them, so who holds a post is still shown only
-- to the people those rules allow. The site's order of battle page, which
-- does show holders, checks that the reader is serving before it shows anything.

grant select on
  public.units, public.positions, public.qualifications, public.position_qualifications
to anon;

-- Each reading rule is widened in place and renamed to say what it now does.
alter policy "The fleet reads units" on public.units
  to anon, authenticated using (true);
alter policy "The fleet reads units" on public.units
  rename to "Anyone can read the units";

alter policy "The fleet reads positions" on public.positions
  to anon, authenticated using (true);
alter policy "The fleet reads positions" on public.positions
  rename to "Anyone can read the positions";

alter policy "The fleet reads qualifications" on public.qualifications
  to anon, authenticated using (true);
alter policy "The fleet reads qualifications" on public.qualifications
  rename to "Anyone can read the qualifications";

alter policy "The fleet reads what positions require" on public.position_qualifications
  to anon, authenticated using (true);
alter policy "The fleet reads what positions require" on public.position_qualifications
  rename to "Anyone can read what positions require";
