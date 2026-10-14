/**
 * Training records: the words and checks that need no database. The lessons
 * of a course are command's to write; this reads a lesson's form.
 */

export const LESSON_NAME_LIMIT = 80;
export const LESSON_DESCRIPTION_LIMIT = 600;

/** What a lesson's form holds, or what is wrong with it. `get` reads one field as tidy text. */
export function readLesson(get: (name: string) => string): { fields: { name: string; description: string; sort_order: number } } | { problem: string } {
  const name = get("name");
  if (name.length === 0) return { problem: "Give the lesson a name." };
  if (name.length > LESSON_NAME_LIMIT) return { problem: `Keep the name under ${LESSON_NAME_LIMIT} characters.` };
  const description = get("description");
  if (description.length > LESSON_DESCRIPTION_LIMIT) return { problem: `Keep the description under ${LESSON_DESCRIPTION_LIMIT} characters.` };
  const order = get("sort_order");
  if (!/^\d{1,4}$/.test(order)) return { problem: "The place in the list is a whole number." };
  return { fields: { name, description, sort_order: Number(order) } };
}

/** "3 of 5 lessons", as the pages say it. */
export const progressWords = (passed: number, lessons: number) => `${passed} of ${lessons} ${lessons === 1 ? "lesson" : "lessons"}`;
