import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHead } from "@/components/PageHead";
import { getOperation, type Operation } from "@/lib/operations";

/**
 * What the pages for changing an event share: the head, the links between
 * them, and the check that the person asking may change this event.
 */

export type EditPart = "details" | "taking" | "orders";
export type Ready = Extract<Operation, { state: "ready" }>;

export function EditHead({ id, title, lead }: { id?: string; title: string; lead: string }) {
  return (
    <PageHead
      picture="operations"
      slim
      before={
        <p className="back">
          <Link href={id ? `/operations/${id}` : "/operations"}>{id ? "Back to the event" : "Operations"}</Link>
        </p>
      }
      title={<strong>{title}</strong>}
      lead={lead}
    />
  );
}

const parts: { key: EditPart; label: string; path: string }[] = [
  { key: "details", label: "Details", path: "" },
  { key: "taking", label: "Who takes part", path: "/taking" },
  { key: "orders", label: "Orders and plan", path: "/orders" },
];

/** The three pages an event is changed on, as a row of links. */
export function EditNav({ id, current }: { id: string; current: EditPart }) {
  return (
    <nav aria-label="Parts of the event">
      <ul className="parts editor-nav">
        {parts.map((part) => (
          <li key={part.key}>
            <Link href={`/operations/${id}/edit${part.path}`} aria-current={part.key === current ? "page" : undefined}>
              {part.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * The event, for someone who may change it. Anyone else is answered here:
 * sent to sign in, told it is not found, or shown a head that says why not.
 */
export async function openForEdit(id: string): Promise<{ result: Ready } | { shut: React.ReactNode }> {
  const result = await getOperation(id);
  if (result.state === "signed-out") redirect("/sign-in");
  if (result.state === "no-record") redirect("/profile");
  if (result.state === "no-database") return { shut: <EditHead title="Event" lead="This site is not connected to the fleet's database yet." /> };
  if (result.state === "outside") return { shut: <EditHead title="Event" lead="Operations are for the serving fleet." /> };
  if (result.state === "not-found") notFound();

  const { event, edits } = result;
  if (!edits) return { shut: <EditHead id={event.id} title={event.title} lead="This event is run by its commander and by command." /> };
  if (event.state === "done" || event.state === "cancelled") {
    return { shut: <EditHead id={event.id} title={event.title} lead="This event is closed, so its details and orders are fixed." /> };
  }
  return { result };
}
