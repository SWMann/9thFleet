import Link from "next/link";
import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/Icon";
import { PageHead } from "@/components/PageHead";
import { reaches, type Gate, type Tier } from "@/lib/admin";

export type AdminPage = "overview" | "people" | "recruiting" | "operations" | "structure" | "logs";

/** The admin pages, in the order of their tabs, and the tier each one is for. */
const pages: { key: AdminPage; href: string; label: string; icon: IconName; needs: Tier }[] = [
  { key: "overview", href: "/admin", label: "Overview", icon: "grid", needs: "staff" },
  { key: "people", href: "/admin/people", label: "People", icon: "people", needs: "staff" },
  { key: "recruiting", href: "/admin/recruiting", label: "Recruiting", icon: "inbox", needs: "staff" },
  { key: "operations", href: "/admin/operations", label: "Operations", icon: "calendar", needs: "command" },
  { key: "structure", href: "/admin/structure", label: "Structure", icon: "layers", needs: "admin" },
  { key: "logs", href: "/admin/logs", label: "Logs", icon: "list", needs: "admin" },
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
        <nav className="subbar subbar-tabs" aria-label="Fleet admin">
          <div className="wrap subbar-row subbar-many">
            {offered.map((page) => (
              <Link href={page.href} key={page.key} aria-current={page.key === current ? "page" : undefined}>
                <Icon name={page.icon} size={18} />
                <span className="subbar-label">{page.label}</span>
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
