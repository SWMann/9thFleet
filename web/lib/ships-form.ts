/**
 * The ship register: the words and checks that need no database.
 */

export const SHIP_NAME_LIMIT = 60;
export const SHIP_NOTE_LIMIT = 600;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What the register's form holds, or what is wrong with it. `get` reads one field as tidy text. */
export function readShip(get: (name: string) => string): { fields: { model_id: string; name: string; ready: boolean; note: string } } | { problem: string } {
  const model = get("model");
  if (!UUID.test(model)) return { problem: "Choose the model from the list." };
  const name = get("name");
  if (name.length > SHIP_NAME_LIMIT) return { problem: `Keep the name under ${SHIP_NAME_LIMIT} characters.` };
  if (/[\u0000-\u001f\u007f\u200b\u2028-\u202e\u2060-\u2069\ufeff]/.test(name)) return { problem: "The name has a hidden character in it. Type it again." };
  const note = get("note");
  if (note.length > SHIP_NOTE_LIMIT) return { problem: `Keep the note under ${SHIP_NOTE_LIMIT} characters.` };
  return { fields: { model_id: model, name, ready: get("ready") === "on" || get("ready") === "yes", note } };
}

/** "3 of 5 ready", as the pages say it. */
export const readyWords = (ready: number, hulls: number) => `${ready} of ${hulls} ready`;

/** How long since a mark, in days, as the register says it. */
export function sinceWords(iso: string, now: number): string {
  const days = Math.floor((now - Date.parse(iso)) / (24 * 60 * 60 * 1000));
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  return `${Math.floor(days / 30)} months ago`;
}
