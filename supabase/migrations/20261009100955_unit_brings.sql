-- What a unit brings, and a picture for it.
--
-- Whoever writes an event chooses its force from a chart of the order of
-- battle. Beside each unit's posts and who fills them, the chart lists what
-- the unit brings: a short list an admin keeps for it. A unit is drawn with
-- the symbol for its kind unless an admin gives it one of the site's pictures.
--
-- Both are part of the structure, which anyone can read and only an admin changes.

alter table public.units
  -- What the unit brings to an event, one thing to a line.
  add column brings text not null default '' check (char_length(brings) <= 600),
  -- The name of one of the site's pictures, or nothing for the symbol of its kind.
  add column picture text check (picture is null or char_length(picture) between 1 and 40);
