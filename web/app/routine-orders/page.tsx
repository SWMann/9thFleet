import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { Icon } from "@/components/Icon";
import { PageHead } from "@/components/PageHead";
import { EVERY_DAYS, dayOf, orderName } from "@/lib/orders-form";
import { getRoutineOrders } from "@/lib/routine-orders";
import { DraftButton } from "./OrderForms";

export const metadata: Metadata = {
  title: "Routine orders",
  robots: { index: false, follow: false },
};

const title = (
  <>
    Routine <strong>orders</strong>
  </>
);

export default function RoutineOrdersPage() {
  return (
    <Suspense fallback={<Head lead="Reading the orders." />}>
      <Orders />
    </Suspense>
  );
}

function Head({ lead, children }: { lead: string; children?: ReactNode }) {
  return (
    <PageHead picture="operations" slim title={title} lead={lead}>
      {children}
    </PageHead>
  );
}

async function Orders() {
  const result = await getRoutineOrders();
  if (result.state === "signed-out") redirect("/sign-in");
  if (result.state === "no-record") redirect("/profile");
  if (result.state === "no-database") return <Head lead="This site is not connected to the fleet's database yet." />;
  if (result.state === "outside") {
    return (
      <Head lead="Routine orders are for the serving fleet. You will see them once your application has been accepted.">
        <p className="actions">
          <Link className="button button-quiet" href="/profile">
            Your record
          </Link>
        </p>
      </Head>
    );
  }

  const { command, issues, draft, readBy, serving, since, names } = result;
  const who = (id: string | null) => (id ? (names[id] ?? "someone who has left") : "nobody on record");
  const unread = issues.filter((issue) => !issue.read).length;
  const latest = issues[0];
  const lead =
    issues.length === 0
      ? "Nothing has been issued yet."
      : `${issues.length} ${issues.length === 1 ? "issue" : "issues"}. The latest, ${orderName(latest.number ?? 0)}, was issued ${dayOf(latest.issuedAt ?? latest.draftedAt)}.${unread > 0 ? ` ${unread} ${unread === 1 ? "is" : "are"} unread.` : ""}`;

  return (
    <>
      <Head lead={lead}>
        {command ? (
          <p className="actions">
            {draft ? (
              <Link className="button" href="/routine-orders/draft">
                Continue the draft
              </Link>
            ) : null}
            <Link className="button button-quiet" href="/operations">
              Operations
            </Link>
          </p>
        ) : null}
      </Head>

      {command ? (
        <section className="wrap band" aria-labelledby="next-issue">
          <h2 id="next-issue">
            The next <strong>issue</strong>
          </h2>
          {since.due ? (
            <p className="notice">
              <Icon name="clock" size={16} />
              <span>
                The last issue was {since.days} days ago. Routine orders are issued every {EVERY_DAYS} days, so the next is due.
              </span>
            </p>
          ) : null}
          {draft ? (
            <p className="intro">
              A draft has been waiting since {dayOf(draft.draftedAt)}, opened by {who(draft.draftedBy)}. It records {dayOf(draft.coversFrom)} to{" "}
              {dayOf(draft.coversTo)}. <Link href="/routine-orders/draft">Continue it</Link>, or discard it there and draft afresh.
            </p>
          ) : (
            <>
              <p className="intro">
                The site writes the record since the last issue into the draft: appointments, promotions, qualifications, who joined and left,
                operations held and ahead, the hostile list and strength. You add your own words and issue it. Nothing is sent to the fleet
                until then.
              </p>
              <DraftButton />
            </>
          )}
        </section>
      ) : null}

      <section className="wrap band band-last" aria-labelledby="issued">
        <h2 id="issued">
          <strong>Issued</strong>
        </h2>
        {issues.length > 0 ? (
          <ul className="issues">
            {issues.map((issue) => (
              <li className={`issue ${issue.read ? "" : "issue-unread"}`} key={issue.id}>
                <div className="issue-head">
                  <h3>
                    <Link href={`/routine-orders/${issue.number}`}>{orderName(issue.number ?? 0)}</Link>
                  </h3>
                  <p className="hostile-chips">
                    {issue.read ? (
                      <span className="chip chip-icon">
                        <Icon name="check" size={14} />
                        Read
                      </span>
                    ) : (
                      <span className="chip chip-icon chip-amber">
                        <Icon name="inbox" size={14} />
                        Unread
                      </span>
                    )}
                  </p>
                </div>
                {issue.title ? <p className="issue-title">{issue.title}</p> : null}
                <p className="issue-facts">
                  Issued {dayOf(issue.issuedAt ?? issue.draftedAt)} by {who(issue.issuedBy)}. Records {dayOf(issue.coversFrom)} to {dayOf(issue.coversTo)}.
                  {command ? ` Read by ${readBy[issue.id] ?? 0} of ${serving}.` : ""}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty">{command ? "Draft the first issue above." : "The first issue will appear here."}</p>
        )}
      </section>
    </>
  );
}
