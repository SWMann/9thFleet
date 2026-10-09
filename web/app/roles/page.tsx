import type { Metadata } from "next";
import Link from "next/link";
import { RichLine } from "@/components/rich/Rich";
import { Suspense } from "react";
import { ManualBar } from "@/components/manual/ManualBar";
import { PageHead } from "@/components/PageHead";
import { Picture } from "@/components/Picture";
import { domains } from "@/lib/areas";
import { getRoles, sizeOf } from "@/lib/roles";
import { AreaFilter } from "./AreaFilter";

export const metadata: Metadata = {
  title: "Roles",
  description:
    "Every area of work in the UEE 9th Fleet, from command posts and gunnery to staff duties, with the posts in each and what they need.",
};

export default function RolesPage() {
  return (
    <>
      <ManualBar current="role" />
      <PageHead
        picture="roles"
        title={
          <>
            Roles in the <strong>fleet</strong>
          </>
        }
        lead="Every post belongs to an area of work. Pick an area to see its posts and what each one needs."
      />
      <Suspense
        fallback={
          <section className="wrap band band-last">
            <p>Reading the roles.</p>
          </section>
        }
      >
        <Areas />
      </Suspense>
    </>
  );
}

async function Areas() {
  const result = await getRoles();
  if (result.state === "no-database") {
    return (
      <section className="wrap band band-last">
        <p>This site is not connected to the fleet&apos;s database yet.</p>
      </section>
    );
  }

  const { areas, stage } = result;
  const groups = domains.map((domain) => {
    const mine = areas.filter((area) => area.domain === domain.key);
    return { key: domain.key, label: domain.label, areas: mine.length, open: mine.filter((area) => area.open).length };
  });

  return (
    <section className="tiles-band" aria-label="Areas">
      <AreaFilter groups={groups}>
        {areas.map((area) => (
          <article className={area.open ? "tile" : "tile tile-later"} data-domain={area.domain} key={area.slug}>
            <Picture name={area.picture} sizes="(max-width: 820px) 100vw, (max-width: 1240px) 50vw, 33vw" credit="bottom-right" />
            <div className="tile-shade" aria-hidden="true" />
            <p className="tile-top">
              {area.open ? (
                <span className="chip chip-on">Open now</span>
              ) : (
                <span className="chip">Opens at stage {area.opensAtStage}</span>
              )}
              <span className="chip">{sizeOf(area)}</span>
            </p>
            <div className="tile-band">
              <p className="tile-domain">{domains.find((domain) => domain.key === area.domain)?.label}</p>
              <h2>
                <Link href={`/roles/${area.slug}`}>{area.name}</Link>
              </h2>
            </div>
            <p className="tile-foot">
              <RichLine text={area.about} />
            </p>
          </article>
        ))}
      </AreaFilter>
      <p className="wrap tiles-note">
        The fleet is at stage {stage}. An area opens when the fleet reaches its stage. Who holds each post is shown to
        serving members on the <Link href="/order-of-battle">order of battle</Link>.
      </p>
    </section>
  );
}
