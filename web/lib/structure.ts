import "server-only";
import { shipKindOf, shipKinds } from "./ship-kinds";
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
type Source = "areas" | "roles" | "units" | "posts" | "event-types" | "situations";

type Common = {
  key: string;
  label: string;
  hint?: string;
  required?: boolean;
  onlyWhenNew?: boolean;
  /** What a new record starts with. */
  initial?: string;
  /** For a choice that is not required: what an empty choice is kept as, where the column takes no null. */
  empty?: "";
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
  /** Several other records, or the standing choices given as `tokens`, kept in the sheet's linked table under this field's key. */
  | (Common & { kind: "records"; source: Source; tokens?: Option[]; most: number })
  | (Common & { kind: "yes-no" });

/** A field as the form is given it, with its choices filled in. */
export type Field =
  | Exclude<FieldSpec, { kind: "record" } | { kind: "records" }>
  | (Common & { kind: "record"; source: Source; options: Option[] })
  | (Common & { kind: "records"; source: Source; tokens?: Option[]; most: number; options: Option[] });

export type SheetKey = "areas" | "roles" | "units" | "posts" | "qualifications" | "event-types" | "situations" | "tasks" | "ships" | "ship-roles";

export type Sheet = {
  key: SheetKey;
  table: "areas" | "fleet_roles" | "units" | "positions" | "qualifications" | "event_types" | "situations" | "tasks" | "ship_models" | "ship_roles";
  /** What one record is called, and several. */
  one: string;
  many: string;
  about: string;
  fields: FieldSpec[];
  /** The table that holds what a record of this sheet needs, and the column that points back at it. */
  needs?: { table: "fleet_role_qualifications" | "position_qualifications"; column: "role_id" | "position_id"; about: string };
  /** The table that holds a record's `records` fields, one row each under the field's key as its part, and the column that points back at the record. */
  links?: { table: "task_roles"; column: "task_id" };
  /** What to say when a record cannot be removed because something hangs from it. */
  inUse: string;
  /** What to say when another record already has its name. Left out, it speaks of a name or an address. */
  taken?: string;
};

const stage = (key: string, label: string, hint?: string): FieldSpec => ({ key, label, kind: "number", min: 1, max: 9, required: true, hint });
/** One of the responsibility matrix's four stages: launch, about 16, about 60, the fleet. */
const matrixStage = (key: string, label: string, hint: string, required: boolean): FieldSpec => ({ key, label, kind: "number", min: 1, max: 4, required, initial: required ? "1" : undefined, hint: `${hint} 1 is launch, 2 about sixteen, 3 about sixty, 4 the fleet.` });
const echelons: Option[] = ["Fleet", "Task force", "Air group", "Ship", "Section"].map((name) => ({ value: name, label: name }));
const phases: Option[] = [
  { value: "planning", label: "Planning" },
  { value: "muster", label: "Muster and brief" },
  { value: "underway", label: "Underway" },
  { value: "recovery", label: "Recovery" },
  { value: "after", label: "After" },
  { value: "drill", label: "The drill, for a situation" },
];
const everyone: Option[] = [
  { value: "token:whole_force", label: "The whole force" },
  { value: "token:ships_company", label: "The ship's company" },
];
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

// The kinds of hull live in their own file, which a form in the browser may read.
export { shipKinds, shipKindOf } from "./ship-kinds";

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
      { key: "slug", label: "Address", kind: "slug", required: true, hint: "The end of its address on the site: /roles/gunnery. Change it and the old address goes on forwarding to the new." },
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
    inUse: "This role still has posts, or tasks of the matrix name it, or a station of a crew template is of it. Move those to another role first.",
    needs: {
      table: "fleet_role_qualifications",
      column: "role_id",
      about: "What every post of this role needs, on every ship. A post can need more on top.",
    },
    fields: [
      { key: "name", label: "Name", kind: "text", max: 60, required: true },
      { key: "slug", label: "Address", kind: "slug", required: true, hint: "The end of its address on the site: /roles/gunnery/gunner. Change it and the old address goes on forwarding to the new." },
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
      matrixStage("exists_from", "Exists from stage", "The first stage a post of this role is filled at. Until then its tasks are held by its fallback.", true),
      {
        key: "fallback_role_id",
        label: "Fallback",
        kind: "record",
        source: "roles",
        hint: "The role that holds this one's tasks until it exists. Every role that comes after launch needs one, and a chain of fallbacks ends at a role that exists at launch.",
      },
      {
        key: "echelon",
        label: "Stands at",
        kind: "choice",
        empty: "",
        options: [...echelons, { value: "Individual", label: "Individual" }],
        hint: "The level the post works at: the fleet, a task force, an air group, a ship, a section, or as an individual.",
      },
      {
        key: "post_type",
        label: "Post type",
        kind: "choice",
        empty: "",
        options: [
          { value: "officer", label: "Officer" },
          { value: "rating", label: "Rating" },
          { value: "either", label: "Either" },
        ],
      },
      {
        key: "speciality_of_role_id",
        label: "A speciality of",
        kind: "record",
        source: "roles",
        hint: "For a role that is one way of doing a base role: Turret Gunner is a speciality of Gunner. It does what the base role does, and a station of it counts for the base.",
      },
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
    inUse: "Events of this type exist, or tasks of it under Tasks, so it cannot be removed. It can be renamed.",
    taken: "Another event type already has that name or code.",
    fields: [
      { key: "name", label: "Name", kind: "text", max: 60, required: true },
      { key: "key", label: "Code", kind: "slug", max: 40, required: true, onlyWhenNew: true, hint: "A short name for it that never changes: boarding-drill." },
      { key: "run_by", label: "Usually run by", kind: "text", max: 80, hint: "Shown to whoever drafts one: Training team." },
      { key: "example", label: "Such as", kind: "text", max: 200, hint: "An example, shown to whoever drafts one." },
      { key: "family", label: "Family", kind: "text", max: 40, hint: "The types index groups by it: Presence and response, Protective, Offensive, Enabling." },
      { key: "aim", label: "Aim", kind: "text", max: 200, hint: "One line on what the type is for. It heads the type's page." },
      matrixStage("opens_at", "Opens at stage", "The first stage the fleet runs this type. Its own tasks exist from then.", true),
      { key: "needs", label: "Needs", kind: "text", max: 200, hint: "What has to be in place before one can be run: a second ship, an instructor, a hostile list entry." },
      { key: "minimum_force", label: "Smallest force", kind: "text", max: 120, hint: "One flight, one ship, two ships with air." },
      { key: "typical_force", label: "Usual force", kind: "text", max: 120 },
      { key: "planned_or_reactive", label: "Planned or reactive", kind: "text", max: 40, hint: "Planned, Reactive, or Reactive or planned." },
      { key: "contact_expected", label: "Contact expected", kind: "text", max: 40, hint: "None (scripted), Unlikely, Possible, Likely, Expected, Certain, Avoided." },
      { key: "notes", label: "Notes", kind: "text", max: 200, hint: "Variants, and anything else whoever drafts one should know." },
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
  {
    key: "situations",
    table: "situations",
    one: "situation",
    many: "Situations",
    about: "What can land on any night: a contact, a casualty, a boarding. Each has a drill of tasks, kept under Tasks, and the serving fleet reads them under Operations.",
    inUse: "This situation still has tasks. Remove them first, under Tasks.",
    taken: "Another situation already has that name or address.",
    fields: [
      { key: "name", label: "Name", kind: "text", max: 80, required: true },
      { key: "slug", label: "Address", kind: "slug", required: true, onlyWhenNew: true, hint: "A short name for it that never changes: unknown-contact. The end of its address under Operations." },
      { key: "what_you_see", label: "What you see", kind: "text", max: 200, hint: "What is seen or heard that says this is happening." },
      { key: "calls_role_id", label: "Called by", kind: "record", source: "roles", hint: "The role whose word starts the drill." },
      { key: "owns_role_id", label: "Owned by", kind: "record", source: "roles", hint: "The role that owns the drill once it is called." },
      { key: "notes", label: "Notes", kind: "long", max: 300, rows: 2 },
      order,
    ],
  },
  {
    key: "tasks",
    table: "tasks",
    one: "task",
    many: "Tasks",
    about:
      "The responsibility matrix: what is done on a night, by phase, and who does it, leads it, supervises it, is consulted and is informed. A task of every operation names no type and no situation; a type's own task names its type; a situation's drill names its situation. The serving fleet reads them under Operations, and each role's page lists its own.",
    inUse: "Something still points at this task.",
    links: { table: "task_roles", column: "task_id" },
    fields: [
      { key: "wording", label: "The task", kind: "text", max: 200, required: true, hint: "What is done, as an order: Open the voice nets and check every member is on the right net." },
      { key: "event_type_id", label: "Of the type", kind: "record", source: "event-types", hint: "Leave it empty for a task of every operation, or of a situation's drill." },
      { key: "situation_id", label: "Of the situation", kind: "record", source: "situations", hint: "For a drill's task. A task is of a type or of a situation, never both." },
      { key: "phase", label: "Phase", kind: "choice", options: phases, required: true, hint: "A situation's task is in the drill; every other task is in one of the five phases." },
      { key: "echelon", label: "Echelon", kind: "choice", options: echelons, required: true, hint: "The level the task is done at." },
      { key: "does_role_id", label: "Done by", kind: "record", source: "roles", required: true, hint: "Where the role does not exist yet, its fallback does it." },
      { key: "leads_role_id", label: "Led by", kind: "record", source: "roles", required: true },
      { key: "supervises_command_role_id", label: "Supervised by", kind: "record", source: "roles", hint: "The command line: who answers for it." },
      { key: "supervises_technical_role_id", label: "Supervised for the standard by", kind: "record", source: "roles", hint: "The technical line: who sets how it is done well." },
      { key: "consulted", label: "Consulted", kind: "records", source: "roles", tokens: everyone, most: 12, hint: "Hold Ctrl, or Cmd on a Mac, to choose several." },
      { key: "informed", label: "Informed", kind: "records", source: "roles", tokens: everyone, most: 12 },
      matrixStage("needed_from", "Needed from stage", "For a task of every operation or of a drill: the first stage it is done at. A type's own task takes its type's stage, so leave it empty.", false),
      { key: "notes", label: "Notes", kind: "text", max: 200 },
      { ...order, hint: "Lower comes first within its phase." },
    ],
  },
  {
    key: "ships",
    table: "ship_models",
    one: "ship model",
    many: "Ship models",
    about: "The hulls the fleet flies: each model's maker, kind and crew. Members register their own ships from this list, and command keeps each model's crew templates under Fleet admin.",
    inUse: "Someone has registered a ship of this model. Take those off the register first. A plan that named it keeps its words.",
    taken: "Another model already has that name or address.",
    fields: [
      { key: "name", label: "Name", kind: "text", max: 60, required: true, hint: "As the game names it: Idris-M, F7C Hornet Mk II." },
      { key: "slug", label: "Address", kind: "slug", required: true, onlyWhenNew: true, hint: "A short name for it that never changes: idris-m." },
      { key: "maker", label: "Maker", kind: "text", max: 60, hint: "Aegis Dynamics, Anvil Aerospace, and so on." },
      {
        key: "kind",
        label: "Kind",
        kind: "choice",
        required: true,
        options: shipKinds.map((kind) => ({ value: kind.key, label: kind.name })),
        hint: "What the hull is for. The register and the readiness view group by it.",
      },
      { key: "crew_min", label: "Smallest crew", kind: "number", min: 1, max: 200, required: true, initial: "1", hint: "The game's listed minimum." },
      { key: "crew_max", label: "Largest crew", kind: "number", min: 1, max: 200, required: true, initial: "1", hint: "The game's listed maximum. The crew template says who they are." },
      { key: "flyable", label: "Can be flown in the game today", kind: "yes-no", initial: "yes", hint: "Nobody registers a hull that cannot be flown yet." },
      order,
    ],
  },
  {
    key: "ship-roles",
    table: "ship_roles",
    one: "ship role",
    many: "Ship roles",
    about: "What a hull does for the fleet: escort, strike, logistics, and so on. A kind says what a model is; its roles say what it does, and a model may have several. Command gives each model its roles under Fleet admin, Ships; the fleet board narrows by them.",
    inUse: "Some model still has this role. Take it off those models first, under Fleet admin, Ships.",
    taken: "Another role already has that name or address.",
    fields: [
      { key: "name", label: "Name", kind: "text", max: 60, required: true, hint: "Escort, Fire support, Assault transport." },
      { key: "slug", label: "Address", kind: "slug", required: true, onlyWhenNew: true, hint: "A short name for it that never changes: fire-support." },
      { key: "description", label: "What it means", kind: "long", max: 300, rows: 2, hint: "One line, shown where the role is picked." },
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

  const [rows, areas, roles, units, posts, qualifications, needs, eventTypes, situations, links] = await Promise.all([
    supabase.from(sheet.table).select("*"),
    supabase.from("areas").select("id, name, sort_order"),
    supabase.from("fleet_roles").select("id, name, kind, area_id, sort_order"),
    supabase.from("units").select("id, name, parent_id, sort_order"),
    supabase.from("positions").select("id, title, unit_id, kind"),
    supabase.from("qualifications").select("id, name"),
    sheet.needs ? supabase.from(sheet.needs.table).select("*") : Promise.resolve({ data: [] as Row[], error: null }),
    supabase.from("event_types").select("id, name, sort_order"),
    supabase.from("situations").select("id, name, sort_order"),
    sheet.links ? supabase.from(sheet.links.table).select("*") : Promise.resolve({ data: [] as Row[], error: null }),
  ]);
  for (const result of [rows, areas, roles, units, posts, qualifications, needs, eventTypes, situations, links]) {
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

  const byPlace = (a: Row, b: Row) => Number(a.sort_order) - Number(b.sort_order) || String(a.name).localeCompare(String(b.name));
  const typeRows = ((eventTypes.data ?? []) as Row[]).sort(byPlace);
  const typeName = new Map(typeRows.map((row) => [row.id as string, row.name as string]));
  const situationRows = ((situations.data ?? []) as Row[]).sort(byPlace);
  const situationName = new Map(situationRows.map((row) => [row.id as string, row.name as string]));
  const options: Record<Source, Option[]> = {
    areas: areaRows.map((row) => ({ value: row.id as string, label: row.name as string })),
    roles: roleRows.map((row) => ({ value: row.id as string, label: `${row.name}${row.kind === "duty" ? " (duty)" : ""}` })),
    units: unitOptions,
    "event-types": typeRows.map((row) => ({ value: row.id as string, label: row.name as string })),
    situations: situationRows.map((row) => ({ value: row.id as string, label: row.name as string })),
    // A post with its unit, since several units have a post of the same title. A duty commands nothing.
    posts: ((posts.data ?? []) as Row[])
      .filter((row) => row.kind === "primary")
      .map((row) => ({ value: row.id as string, label: `${unitPath(row.unit_id)}: ${row.title}` }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  };
  const fields: Field[] = sheet.fields.map((field) =>
    field.kind === "record" ? { ...field, options: options[field.source] } : field.kind === "records" ? { ...field, options: [...(field.tokens ?? []), ...options[field.source]] } : field,
  );

  const needRows = (needs.data ?? []) as Row[];
  const linkRows = ((links.data ?? []) as Row[]).sort((a, b) => Number(a.sort_order) - Number(b.sort_order));
  const records = ((rows.data ?? []) as Row[]).map((row): EditRecord => {
    const id = row.id as string;
    const values: Record<string, string> = {};
    for (const field of sheet.fields) {
      values[field.key] =
        field.kind === "records" && sheet.links
          ? linkRows
              .filter((link) => link[sheet.links!.column] === id && link.part === field.key)
              .map((link) => (link.role_id ? (link.role_id as string) : `token:${link.token as string}`))
              .join("\n")
          : asText(row[field.key]);
    }
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
            note: `${row.instructors_may_draft === true ? "Drafted by command and instructors" : "Drafted by command"}, opens at stage ${row.opens_at ?? 1}`,
            group: (row.family as string) || "",
          };
        case "situations":
          return { title: row.name as string, note: (row.what_you_see as string) || `/operations/situations/${row.slug}`, group: "" };
        case "tasks":
          return {
            title: row.wording as string,
            note: `${phases.find((phase) => phase.value === row.phase)?.label ?? row.phase}, ${row.echelon}: ${roleName.get(row.does_role_id as string) ?? "nobody"}`,
            group: row.situation_id ? `The drill: ${situationName.get(row.situation_id as string) ?? "a situation"}` : row.event_type_id ? `Of the type: ${typeName.get(row.event_type_id as string) ?? "a type"}` : "Every operation",
          };
        case "ships":
          return {
            title: row.name as string,
            note: `${row.maker ? `${row.maker}, ` : ""}crew ${row.crew_min === row.crew_max ? row.crew_min : `${row.crew_min} to ${row.crew_max}`}${row.flyable === true ? "" : ", not flyable yet"}`,
            group: shipKindOf(row.kind as string).many,
          };
        case "ship-roles":
          return { title: row.name as string, note: (row.description as string) || "", group: "" };
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
  if (sheet.key === "tasks") {
    // Tasks read as the matrix does: every operation's first, then each type's, then each situation's drill, and within a group by phase then place.
    const home = (row: EditRecord) => (row.group === "Every operation" ? 0 : row.group.startsWith("Of the type") ? 1 : 2);
    const phase = (row: EditRecord) => phases.findIndex((entry) => entry.value === row.values.phase);
    records.sort((a, b) => home(a) - home(b) || a.group.localeCompare(b.group) || phase(a) - phase(b) || place(a) - place(b) || a.title.localeCompare(b.title));
  }
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
  const [areas, roles, units, posts, qualifications, grades, eventTypes, situations, tasks, ships, shipRoles] = await Promise.all([
    read("areas", "id"),
    read("fleet_roles", "id"),
    read("units", "id"),
    read("positions", "id"),
    read("qualifications", "id"),
    read("grades", "code"),
    read("event_types", "id"),
    read("situations", "id"),
    read("tasks", "id"),
    read("ship_models", "id"),
    read("ship_roles", "id"),
  ]);
  return { state: "ready", counts: { areas, roles, units, posts, qualifications, grades, "event-types": eventTypes, situations, tasks, ships, "ship-roles": shipRoles } };
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
