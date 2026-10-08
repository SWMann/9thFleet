import Link from "next/link";
import type { ReactNode } from "react";
import { PageHead } from "@/components/PageHead";
import { reaches, type Gate, type Tier } from "@/lib/admin";

export type AdminPage = "overview" | "people" | "recruiting" | "operations";

/** The admin pages, in the order of their tabs, and the tier each one is for. */
const pages: { key: AdminPage; href: string; label: string; needs: Tier }[] = [
  { key: "overview", href: "/admin", label: "Overview", needs: "staff" },
  { key: "people", href: "/admin/people", label: "People", needs: "staff" },
  { key: "recruiting", href: "/admin/recruiting", label: "Recruiting", needs: "staff" },
  { key: "operations", href: "/admin/operations", label: "Operations", needs: "command" },
];

const tierNames: Record<Tier, string> = { staff: "staff", command: "command", admin: "admins" };

/**
 * The top of every admin page: the banner, then a tab for each page this
 * person's tier reaches. Without a tier there are no tabs.
 */
export function AdminHead({
  current,
  tier,
  title,
  lead,
  children,
}: {
  current: AdminPage;
  tier: Tier | null;
  title: ReactNode;
  lead: ReactNode;
  children?: ReactNode;
}) {
  const offered = tier ? pages.filter((page) => reaches(tier, page.needs)) : [];
  return (
    <>
      <PageHead picture="staff" slim title={title} lead={lead}>
        {children}
      </PageHead>
      {offered.length > 0 ? (
        <nav className="subbar" aria-label="Fleet admin">
          <div className="wrap subbar-row subbar-many">
            {offered.map((page) => (
              <Link href={page.href} key={page.key} aria-current={page.key === current ? "page" : undefined}>
                {page.label}
              </Link>
            ))}
          </div>
        </nav>
      ) : null}
    </>
  );
}

/** What someone sees when the page is not for them, or cannot be read. */
export function AdminShut({
  access,
  current,
  title,
}: {
  access: Extract<Gate, { state: "no-database" | "not-allowed" }>;
  current: AdminPage;
  title: ReactNode;
}) {
  if (access.state === "no-database") {
    return <AdminHead current={current} tier={null} title={title} lead="This site is not connected to the fleet's database yet." />;
  }
  return (
    <AdminHead
      current={current}
      tier={access.tier}
      title={title}
      lead={
        access.tier
          ? `This page is for ${tierNames[access.needed]}. The tabs below are the pages your role opens.`
          : "The admin pages are for the people who run the fleet: its staff, command and admins."
      }
    >
      {access.tier ? null : (
        <p className="actions">
          <Link className="button button-quiet" href="/profile">
            Your record
          </Link>
        </p>
      )}
    </AdminHead>
  );
}
