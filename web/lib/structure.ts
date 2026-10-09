import "server-only";
import { areaPictures, domains } from "@/lib/areas";
import { gate } from "@/lib/admin";
import { paragraphs, weapons } from "@/lib/operations-form";
import { createClient } from "@/lib/supabase/server";

/**
 * The editors: how an admin keeps the fleet's structure on the site.
 *
 * Each kind of record an admin can edit is a sheet. A sheet names its table
 * and lists its fields, and one editor draws every sheet from that list. To
 * make another field editable, add it to its sheet here. To make another kind
 * of record editable, add a sheet. Event types are kept here too, because they
 * are edited the same way.
 *
 * Nothing here decides who may edit. The database does: only an admin's
 * changes get through, and every change is logged.
 */

export type Option = { value: string; label: string };

/** Where a field's choices come from when they are other records. */
type Source = "areas" | "roles" | "units" | "posts";

type Common = {
  key: string;
  label: string;
  hint?: string;
  required?: boolean;
  onlyWhenNew?: boolean;
  /** What a new record starts with. */
  initial?: string;
};
export type FieldSpec =
  | (Common & { kind: "text"; max: number })
  /** An address: lower-case words joined by hyphens. Up to 60 characters unless it says otherwise. */
  | (Common & { kind: "slug"; max?: number })
  /** Longer text. With `rich` it can have bold, italic and links, and is shown in a line of the page. A list kept one to a line stays plain. */
  | (Common & { kind: "long"; max: number; rows: number; rich?: boolean })
  /** A list, one entry to a line. */
  | (Common & { kind: "lines"; most: number })
  | (Common & { kind: "number"; min: number; max: number })
  | (Common & { kind: "choice"; options: Option[] })
  | (Common & { kind: "record"; source: Source })
  | (Common & { kind: "yes-no" });

/** A field as the form is given it, with its choices filled in. */
export type Field = Exclude<FieldSpec, { kind: "record" }> | (Common & { kind: "record"; source: Source; options: Option[] });

export type SheetKey = "areas" | "roles" | "units" | "posts" | "qualifications" | "event-types";

export type Sheet = {
  key: SheetKey;
  table: "areas" | "fleet_roles" | "units" | "positions" | "qualifications" | "event_types";
  /** What one record is called, and several. */
  one: string;
  many: string;
  about: string;
  fields: FieldSpec[];
  /** The table that holds what a record of this sheet needs, and the column that points back at it. */
  needs?: { table: "fleet_role_qualifications" | "position_qualifications"; column: "role_id" | "position_id"; about: string };
  /** What to say when a record cannot be removed because something hangs from it. */
  inUse: string;
  /** What to say when another record already has its name. Left out, it speaks of a name or an address. */
  taken?: string;
};

const stage = (key: string, label: string, hint?: string): FieldSpec => ({ key, label, kind: "number", min: 1, max: 9, required: true, hint });
const order: FieldSpec = { key: "sort_order", label: "Place in the list", kind: "number", min: 0, max: 9999, required: true, initial: "0", hint: "Lower comes first." };

/** The two fields that let a type of event give one section of its orders its own name and guidance. */
const section = (key: string, number: number, name: string, holds: string): FieldSpec[] => [
  { key: `${key}_name`, label: `Section ${number} is called`, kind: "text", max: 60, hint: `Leave it empty to keep Volume 2's: ${name}.` },
  {
    key: `${key}_holds`,
    label: `What section ${number} holds`,
    kind: "long",
    rich: true,
    max: 300,
    rows: 2,
    hint: `Shown under the heading to whoever writes it. Leave it empty to keep Volume 2's: ${holds}`,
  },
];
const reading = (hint: string): FieldSpec => ({ key: "reading", label: "What to read", kind: "lines", most: 20, hint });

const pictureNames: Record<string, string> = {
  areaCommand: "Command",
  areaSignals: "Signals",
  areaHelm: "Helm",
  areaGunnery: "Gunnery",
  areaEngineering: "Engineering",
  areaMedical: "Medical",
  areaDeck: "Flight deck",
  areaSecurity: "Ship security",
  areaFighters: "Fighters",
  areaLift: "Lift",
  areaInfantry: "Infantry",
  areaBoarding: "Boarding",
  areaSupport: "Fleet support",
  areaRecon: "Reconnaissance",
  areaStaff: "Staff",
  areaOther: "Spare",
};

const services: Option[] = [
  { value: "navy", label: "Navy" },
  { value: "army", label: "Army" },
  { value: "marines", label: "Marines" },
];

/** The kinds of unit. A ship, flight, command, staff, task force or fleet is a place in its own right on the roles pages. */
const unitKinds = [
  "fleet", "battle group", "task force", "squadron", "flotilla", "wing", "flight", "ship", "department", "command", "staff",
  "battalion", "company", "platoon", "section", "team",
];

export const GRADES = ["E1", "E2", "E3", "E4", "E5", "E6", "E7", "OC", "O1", "O2", "O3", "O4", "O5", "O6", "O7", "O8", "O9", "O10"];
const grades: Option[] = GRADES.map((code) => ({ value: code, label: code }));

export const sheets: Sheet[] = [
  {
    key: "areas",
    table: "areas",
    one: "area",
    many: "Areas",
    about: "The areas of work the roles are sorted into on the roles pages.",
    inUse: "This area still has roles. Move them to another area first.",
    fields: [
      { key: "name", label: "Name", kind: "text", max: 60, required: true },
      { key: "slug", label: "Address", kind: "slug", required: true, hint: "The end of its address on the site: /roles/gunnery. Changing it breaks links to the old one." },
      { key: "domain", label: "Group", kind: "choice", required: true, options: domains.map((domain) => ({ value: domain.key, label: domain.label })), hint: "The button it is filtered by." },
      {
        key: "picture",
        label: "Picture",
        kind: "choice",
        required: true,
        options: areaPictures.map((name) => ({ value: name, label: pictureNames[name] ?? name })),
        hint: "One of the pictures the site already has.",
      },
      { key: "about", label: "About", kind: "long", rich: true, max: 600, rows: 3, hint: "One or two sentences on what the area is." },
      { key: "planned_stage", label: "Planned for stage", kind: "number", min: 1, max: 9, hint: "For an area with no posts yet: the stage it opens at." },
      { key: "planned_size", label: "Planned size", kind: "text", max: 60, hint: "For an area with no posts yet: \"12 posts\", or the service that mans it." },
      reading("Sections of the manual for this area, one to a line, as volume/section: organisation/navy-squadron."),
      order,
    ],
  },
  {
    key: "roles",
    table: "fleet_roles",
    one: "role",
    many: "Roles",
    about: "What each kind of work is: what it does, what it needs and where it leads. Every post has a role.",
    inUse: "This role still has posts. Move them to another role first.",
    needs: {
      table: "fleet_role_qualifications",
      column: "role_id",
      about: "What every post of this role needs, on every ship. A post can need more on top.",
    },
    fields: [
      { key: "name", label: "Name", kind: "text", max: 60, required: true },
      { key: "slug", label: "Address", kind: "slug", required: true, hint: "The end of its address on the site: /roles/gunnery/gunner. Changing it breaks links to the old one." },
      { key: "area_id", label: "Area", kind: "record", source: "areas", required: true },
      {
        key: "kind",
        label: "Kind",
        kind: "choice",
        required: true,
        options: [
          { value: "primary", label: "Primary role: its post sets the holder's rank" },
          { value: "duty", label: "Secondary duty: held as well as a post" },
        ],
        hint: "It cannot change while the role has posts.",
      },
      { key: "summary", label: "Summary", kind: "long", rich: true, max: 300, rows: 2, hint: "One or two sentences on what the role is. It heads the role's page." },
      { key: "duties", label: "What the role does", kind: "long", max: 4000, rows: 6, hint: "One duty to a line. Leave it empty until it is written." },
      reading("Sections of the manual for this role, on top of its area's. One to a line, as volume/section."),
      { key: "next_role_id", label: "Leads to", kind: "record", source: "roles", hint: "The role a holder moves on to. Leave it empty if there is none." },
      order,
    ],
  },
  {
    key: "units",
    table: "units",
    one: "unit",
    many: "Units",
    about: "The fleet's formations, ships and departments, each under the one above it.",
    inUse: "This unit still has posts or units under it. Move or remove them first.",
    fields: [
      { key: "name", label: "Name", kind: "text", max: 80, required: true },
      { key: "parent_id", label: "Under", kind: "record", source: "units", hint: "The unit it belongs to. Only the fleet itself has none." },
      { key: "kind", label: "Kind", kind: "choice", required: true, options: unitKinds.map((kind) => ({ value: kind, label: kind[0].toUpperCase() + kind.slice(1) })) },
      { key: "service", label: "Service", kind: "choice", options: services, hint: "Its posts can only be held by members of this service. Leave it empty for a unit open to all." },
      stage("opens_at_stage", "Opens at stage", "Nothing in it can be filled before then."),
      {
        key: "commander_position_id",
        label: "Commanded by",
        kind: "record",
        source: "posts",
        hint: "The post that commands this unit. It can sit in a unit under it, as a ship's commanding officer sits on the bridge. Whoever holds it reads the tasks of every unit under this one.",
      },
      {
        key: "brings",
        label: "What it brings",
        kind: "long",
        max: 600,
        rows: 4,
        hint: "What the unit brings to an event, one thing to a line: Four turrets. A medical bed. It is shown to whoever chooses an event's force.",
      },
      {
        key: "picture",
        label: "Picture",
        kind: "choice",
        options: areaPictures.map((name) => ({ value: name, label: pictureNames[name] ?? name })),
        hint: "One of the pictures the site already has, for the chart an event's force is chosen from. Leave it empty and the unit is drawn with the symbol for its kind.",
      },
      order,
    ],
  },
  {
    key: "posts",
    table: "positions",
    one: "post",
    many: "Posts",
    about: "The places in each unit. A post has a role, and holds one member.",
    inUse: "Someone holds or has held this post, so it is part of the service record and cannot be removed.",
    needs: {
      table: "position_qualifications",
      column: "position_id",
      about: "What this post needs on top of what its role needs.",
    },
    fields: [
      { key: "title", label: "Title", kind: "text", max: 80, required: true, hint: "Number the posts of one kind: Turret Gunner 1, Turret Gunner 2." },
      { key: "unit_id", label: "Unit", kind: "record", source: "units", required: true },
      { key: "role_id", label: "Role", kind: "record", source: "roles", required: true, hint: "A post takes its kind from its role: a primary post, or a duty." },
      { key: "nominal_grade", label: "Usual grade", kind: "choice", options: grades, hint: "A primary post needs all three grades. A duty needs none." },
      { key: "min_grade", label: "Lowest grade", kind: "choice", options: grades, hint: "For a duty: the lowest grade that can take it on, if there is one." },
      { key: "max_grade", label: "Highest grade", kind: "choice", options: grades },
      { key: "is_entry", label: "An entry post, which a new member can be given", kind: "yes-no" },
      { key: "is_leader", label: "A leader, who reads a task that is for leaders", kind: "yes-no" },
      stage("opens_at_stage", "Opens at stage", "It can also open no earlier than its unit."),
      order,
    ],
  },
  {
    key: "qualifications",
    table: "qualifications",
    one: "qualification",
    many: "Qualifications",
    about: "What members earn in training. A role or a post can need one.",
    inUse: "Someone holds this qualification, or a role or post needs it. Take those away first.",
    fields: [
      { key: "name", label: "Name", kind: "text", max: 60, required: true },
      { key: "code", label: "Code", kind: "slug", required: true, onlyWhenNew: true, hint: "A short name for it that never changes: net-controller." },
      { key: "description", label: "What it means", kind: "long", rich: true, max: 400, rows: 2, hint: "One sentence on what its holder has shown they can do." },
    ],
  },
  {
    key: "event-types",
    table: "event_types",
    one: "event type",
    many: "Event types",
    about: "The kinds of night the fleet runs: who may draft each, how long it usually is, and what its orders are called.",
    inUse: "Events of this type exist, so it cannot be removed. It can be renamed.",
    taken: "Another event type already has that name or code.",
    fields: [
      { key: "name", label: "Name", kind: "text", max: 60, required: true },
      { key: "key", label: "Code", kind: "slug", max: 40, required: true, onlyWhenNew: true, hint: "A short name for it that never changes: boarding-drill." },
      { key: "run_by", label: "Usually run by", kind: "text", max: 80, hint: "Shown to whoever drafts one: Training team." },
      { key: "example", label: "Such as", kind: "text", max: 200, hint: "An example, shown to whoever drafts one." },
      { key: "instructors_may_draft", label: "Instructors may draft it, as well as command", kind: "yes-no" },
      { key: "needs_approval", label: "A draft by anyone but command needs command's approval before it is announced", kind: "yes-no" },
      {
        key: "default_duration_minutes",
        label: "Usual length, in minutes",
        kind: "number",
        min: 15,
        max: 480,
        required: true,
        initial: "120",
        hint: "What a new event of this type starts with. Whoever drafts it can change it.",
      },
      {
        key: "default_weapons_state",
        label: "Usual weapons state",
        kind: "choice",
        options: weapons.map((state) => ({ value: state.key, label: `${state.name}: ${state.meaning.toLowerCase()}` })),
        hint: "What a new event of this type starts with. Leave it empty for none.",
      },
      ...paragraphs.flatMap((paragraph, index) => section(paragraph.key, index + 1, paragraph.name, paragraph.holds)),
      order,
    ],
  },
];

export const sheetOf = (key: string) => sheets.find((sheet) => sheet.key === key) ?? null;

/** A record as the editor shows it. Every value is text, as a form holds it. */
export type EditRecord = {
  id: string;
  title: string;
  /** A short line under the title. */
  note: string;
  /** The heading it is listed under, if the sheet is grouped. */
  group: string;
  values: Record<string, string>;
  /** What it needs: the ids of the qualifications, and which are let off when acting. */
  needs: { id: string; waived: boolean }[];
};

export type Loaded =
  | { state: "no-database" }
  | { state: "ready"; sheet: Sheet; fields: Field[]; records: EditRecord[]; qualifications: Option[] };

type Row = Record<string, unknown>;

/** Text for a form field, whatever the column holds. */
function asText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.join("\n");
  if (typeof value === "boolean") return value ? "yes" : "";
  return String(value);
}

/** Everything one sheet's editor needs, read as the admin. */
export async function loadSheet(sheet: Sheet): Promise<Loaded> {
  const supabase = await createClient();
  if (!supabase) return { state: "no-database" };

  const [rows, areas, roles, units, posts, qualifications, needs] = await Promise.all([
    supabase.from(sheet.table).select("*"),
    supabase.from("areas").select("id, name, sort_order"),
    supabase.from("fleet_roles").select("id, name, kind, area_id, sort_order"),
    supabase.from("units").select("id, name, parent_id, sort_order"),
    supabase.from("positions").select("id, title, unit_id, kind"),
    supabase.from("qualifications").select("id, name"),
    sheet.needs ? supabase.from(sheet.needs.table).select("*") : Promise.resolve({ data: [] as Row[], error: null }),
  ]);
  for (const result of [rows, areas, roles, units, posts, qualifications, needs]) {
    if (result.error) throw new Error(`The ${sheet.many.toLowerCase()} could not be read: ${result.error.message}`);
  }

  const areaRows = ((areas.data ?? []) as Row[]).sort((a, b) => Number(a.sort_order) - Number(b.sort_order));
  const areaName = new Map(areaRows.map((row) => [row.id as string, row.name as string]));
  const roleRows = ((roles.data ?? []) as Row[]).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const roleName = new Map(roleRows.map((row) => [row.id as string, row.name as string]));
  const unitRows = (units.data ?? []) as Row[];
  const unitById = new Map(unitRows.map((row) => [row.id as string, row]));
  // A unit with the units above it, so two departments called Engineering can be told apart.
  const unitPath = (id: unknown): string => {
    const names: string[] = [];
    let at = typeof id === "string" ? unitById.get(id) : undefined;
    while (at && names.length < 12) {
      names.unshift(at.name as string);
      at = typeof at.parent_id === "string" ? unitById.get(at.parent_id) : undefined;
    }
    return names.length > 1 ? names.slice(1).join(" › ") : (names[0] ?? "");
  };
  const unitOptions = unitRows
    .map((row) => ({ value: row.id as string, label: unitPath(row.id) }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const options: Record<Source, Option[]> = {
    areas: areaRows.map((row) => ({ value: row.id as string, label: row.name as string })),
    roles: roleRows.map((row) => ({ value: row.id as string, label: `${row.name}${row.kind === "duty" ? " (duty)" : ""}` })),
    units: unitOptions,
    // A post with its unit, since several units have a post of the same title. A duty commands nothing.
    posts: ((posts.data ?? []) as Row[])
      .filter((row) => row.kind === "primary")
      .map((row) => ({ value: row.id as string, label: `${unitPath(row.unit_id)}: ${row.title}` }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  };
  const fields: Field[] = sheet.fields.map((field) => (field.kind === "record" ? { ...field, options: options[field.source] } : field));

  const needRows = (needs.data ?? []) as Row[];
  const records = ((rows.data ?? []) as Row[]).map((row): EditRecord => {
    const id = row.id as string;
    const values: Record<string, string> = {};
    for (const field of sheet.fields) values[field.key] = asText(row[field.key]);
    const described = (() => {
      switch (sheet.key) {
        case "areas":
          return { title: row.name as string, note: `/roles/${row.slug}`, group: "" };
        case "roles":
          return {
            title: row.name as string,
            note: row.kind === "duty" ? "Secondary duty" : "Primary role",
            group: areaName.get(row.area_id as string) ?? "No area",
          };
        case "units":
          return { title: row.name as string, note: `${row.kind}, opens at stage ${row.opens_at_stage}`, group: "" };
        case "posts":
          return {
            title: row.title as string,
            note: `${roleName.get(row.role_id as string) ?? "No role"}${row.kind === "duty" ? ", a duty" : `, ${row.min_grade} to ${row.max_grade}`}`,
            group: unitPath(row.unit_id),
          };
        case "event-types":
          return {
            title: row.name as string,
            note: row.instructors_may_draft === true ? "Drafted by command and instructors" : "Drafted by command",
            group: "",
          };
        default:
          return { title: row.name as string, note: String(row.code ?? ""), group: "" };
      }
    })();
    return {
      id,
      ...described,
      values,
      needs: sheet.needs
        ? needRows
            .filter((need) => need[sheet.needs!.column] === id)
            .map((need) => ({ id: need.qualification_id as string, waived: need.waived_when_acting === true }))
        : [],
    };
  });

  const place = (row: EditRecord) => Number(row.values.sort_order ?? 0);
  records.sort((a, b) => a.group.localeCompare(b.group) || place(a) - place(b) || a.title.localeCompare(b.title));
  if (sheet.key === "units") {
    // Units read best as the tree they are: each under the one above it.
    for (const record of records) record.title = unitPath(record.id) || record.title;
    records.sort((a, b) => a.title.localeCompare(b.title));
  }

  return {
    state: "ready",
    sheet,
    fields,
    records,
    qualifications: ((qualifications.data ?? []) as Row[])
      .map((row) => ({ value: row.id as string, label: row.name as string }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  };
}

/** How many of each kind of record there are, for the editors' front page. */
export async function countStructure(): Promise<{ state: "no-database" } | { state: "ready"; counts: Record<SheetKey | "grades", number> }> {
  const supabase = await createClient();
  if (!supabase) return { state: "no-database" };
  const read = async (table: string, column: string) => {
    const { data, error } = await supabase.from(table).select(column);
    if (error) throw new Error(`The ${table} could not be counted: ${error.message}`);
    return (data ?? []).length;
  };
  const [areas, roles, units, posts, qualifications, grades, eventTypes] = await Promise.all([
    read("areas", "id"),
    read("fleet_roles", "id"),
    read("units", "id"),
    read("positions", "id"),
    read("qualifications", "id"),
    read("grades", "code"),
    read("event_types", "id"),
  ]);
  return { state: "ready", counts: { areas, roles, units, posts, qualifications, grades, "event-types": eventTypes } };
}

export type RankTable =
  | { state: "no-database" }
  | { state: "ready"; grades: { code: string; typicalPosition: string; navy: string; army: string; marines: string }[] };

/** Every grade with what it usually does and its three rank names. */
export async function loadRanks(): Promise<RankTable> {
  const supabase = await createClient();
  if (!supabase) return { state: "no-database" };
  const [grades, ranks] = await Promise.all([
    supabase.from("grades").select("code, sort_order, typical_position").order("sort_order", { ascending: true }),
    supabase.from("ranks").select("service, grade_code, name"),
  ]);
  if (grades.error) throw new Error(`The grades could not be read: ${grades.error.message}`);
  if (ranks.error) throw new Error(`The ranks could not be read: ${ranks.error.message}`);
  const name = (service: string, code: string) =>
    ((ranks.data ?? []).find((rank) => rank.service === service && rank.grade_code === code)?.name as string | undefined) ?? "";
  return {
    state: "ready",
    grades: (grades.data ?? []).map((grade) => ({
      code: grade.code as string,
      typicalPosition: grade.typical_position as string,
      navy: name("navy", grade.code as string),
      army: name("army", grade.code as string),
      marines: name("marines", grade.code as string),
    })),
  };
}

/** The editors are for admins. */
export const gateStructure = (page: string) => gate("admin", page);
