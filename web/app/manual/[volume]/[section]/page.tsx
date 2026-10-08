import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/Icon";
import { ManualBar } from "@/components/manual/ManualBar";
import { ManualMark } from "@/components/manual/ManualMark";
import { ManualNav } from "@/components/manual/ManualNav";
import { ManualText } from "@/components/manual/ManualText";
import { Picture } from "@/components/Picture";
import { neighbours, publishedVolumes, readVolume } from "@/lib/manual";

type Props = PageProps<"/manual/[volume]/[section]">;

export function generateStaticParams() {
  return publishedVolumes().flatMap((published) =>
    published.sections.map((section) => ({ volume: published.volume.slug, section: section.slug })),
  );
}

async function find(params: Props["params"]) {
  const { volume: volumeSlug, section: sectionSlug } = await params;
  const published = readVolume(volumeSlug);
  const section = published?.sections.find((entry) => entry.slug === sectionSlug);
  return published && section ? { volume: published.volume, section } : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const found = await find(params);
  if (!found) return { title: "Fleet manual" };
  return {
    title: `${found.section.title} (Volume ${found.volume.number}: ${found.volume.title})`,
    description: found.section.lead || undefined,
  };
}

export default async function SectionPage({ params }: Props) {
  const found = await find(params);
  if (!found) notFound();
  const { volume, section } = found;
  const { before, after } = neighbours(volume.slug, section.slug);

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
          <ManualNav current={`/manual/${volume.slug}/${section.slug}`} />
        </aside>
        <article className="panel">
          <p className="eyebrow">
            <Link href={`/manual/${volume.slug}`}>
              Volume {volume.number} · {volume.title}
            </Link>
          </p>
          <h1 className="panel-title">
            <strong>{section.title}</strong>
          </h1>
          {section.lead ? <p className="panel-lead">{section.lead}</p> : null}
          {section.parts.length > 1 ? (
            <ul className="parts" aria-label="In this section">
              {section.parts.map((part) => (
                <li key={part.slug}>
                  <a href={`#${part.slug}`}>{part.title}</a>
                </li>
              ))}
            </ul>
          ) : null}

          <ManualText text={section.body} />

          <nav className="turn" aria-label="Sections">
            {before ? (
              <Link className="turn-back" href={before.href}>
                <Icon name="arrow" size={22} className="flip" />
                <span>
                  <span className="turn-way">Back to</span>
                  <span className="turn-name">{before.title}</span>
                </span>
              </Link>
            ) : (
              <span />
            )}
            {after ? (
              <Link className="turn-on" href={after.href}>
                <span>
                  <span className="turn-way">Forward to</span>
                  <span className="turn-name">{after.title}</span>
                </span>
                <Icon name="arrow" size={22} />
              </Link>
            ) : null}
          </nav>
        </article>
      </div>
    </>
  );
}
