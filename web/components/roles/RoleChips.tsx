import type { Role } from "@/lib/roles";

/** The chips that say when a role opens and whether a new member can apply for it. */
export function RoleChips({ role }: { role: Role }) {
  return (
    <>
      {role.open ? (
        <span className="chip chip-on">Open now</span>
      ) : (
        <span className="chip">Opens at stage {role.opensAtStage}</span>
      )}
      {role.entry ? <span className="chip chip-gold">Entry post</span> : null}
      {role.kind === "duty" ? <span className="chip">Secondary duty</span> : null}
    </>
  );
}
