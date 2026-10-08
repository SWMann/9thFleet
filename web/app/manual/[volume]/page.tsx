import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ManualBar } from "@/components/manual/ManualBar";
import { ManualMark } from "@/components/manual/ManualMark";
import { ManualNav } from "@/components/manual/ManualNav";
import { ManualText } from "@/components/manual/ManualText";
import { StateChip } from "@/components/manual/StateChip";
import { Picture } from "@/components/Picture";
import { readVolume, volumes } from "@/lib/manual";

type Props = PageProps<"/manual/[volume]">;

// A volume has a page once it is written. One that is only planned has none.
const withPage = () => volumes.filter((volume) => volume.state !== "planned");

export function generateStaticParams() {
  return withPage().map((volume) => ({ volume: volume.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { volume: slug } = await params;
  const volume = withPage().find((entry) => entry.slug === slug);
  if (!volume) return { title: "Fleet manual" };
  return { title: `Volume ${volume.number}: ${volume.title}`, description: `${volume.covers}.` };
}

export default async function VolumePage({ params }: Props) {
  const { volume: slug } = await params;
  const volume = withPage().find((entry) => entry.slug === slug);
  if (!volume) notFound();
  const published = readVolume(slug);

  return (
    <>
      <ManualBar current="volume" />
      <div className="banner banner-slim">
        <Picture name={volume.picture} eager />
        <div className="banner-shade" aria-hidden="true" />
        <div className="wrap page-head manual-head">
          <ManualMark />
        </div>
      </div>

      <div className="wrap columns">
        <aside>
          <ManualNav current={`/manual/${volume.slug}`} />
        </aside>
        <div className="panel">
          <p className="eyebrow">Volume {volume.number}</p>
          <h1 className="panel-title">
            <strong>{volume.title}</strong>
          </h1>
          <p className="panel-state">
            <StateChip state={volume.state} />
            <span>{volume.dated}</span>
          </p>

          {published ? (
            <>
              <ManualText text={published.intro} />
              <h2 className="panel-next">
                In this <strong>volume</strong>
              </h2>
              <ol className="section-list">
                {published.sections.map((section) => (
                  <li key={section.slug}>
                    <Link href={`/manual/${volume.slug}/${section.slug}`}>{section.title}</Link>
                    {section.lead ? <p>{section.lead}</p> : null}
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <div className="manual-text">
              <p>
                This volume covers {volume.covers.charAt(0).toLowerCase() + volume.covers.slice(1)}. It is written, and
                the Fleet Commander is reviewing it.
              </p>
              <p>It is published here once the review is finished.</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
