/**
 * Turn a refusal from the database into something to show a person.
 *
 * The database's own rules raise messages written to be read, such as "This
 * application is closed." Those are passed on. PostgreSQL's built-in messages
 * are not, because they name tables and constraints.
 */
export function explainRefusal(error: { code?: string; message: string }, fallback: string): string {
  const fromARule = ["42501", "23514", "23505", "P0001"].includes(error.code ?? "");
  const builtIn = /row-level security|permission denied|duplicate key|violates|constraint/i.test(error.message);
  return fromARule && !builtIn ? error.message : fallback;
}
