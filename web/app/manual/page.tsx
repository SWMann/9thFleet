import type { Metadata } from "next";
import Link from "next/link";
import { ManualBar } from "@/components/manual/ManualBar";
import { ManualMark } from "@/components/manual/ManualMark";
import { ManualNav } from "@/components/manual/ManualNav";
import { StateChip } from "@/components/manual/StateChip";
import { Picture } from "@/components/Picture";
import { changes, publishedVolumes, volumes } from "@/lib/manual";
import { pictures } from "@/lib/pictures";

export const metadata: Metadata = {
  title: "Fleet manual",
  description: "How the UEE 9th Fleet is organised and commanded: the doctrine volumes, published as each one is reviewed.",
};

export default function ManualPage() {
  const published = publishedVolumes();
  const sections = published.reduce((sum, entry) => sum + entry.sections.length, 0);
  const inReview = volumes.filter((volume) => volume.state === "draft").length;
  // The cards are too small to carry a credit each, so their authors are named once below them.
  const authors = [...new Set(volumes.map((volume) => pictures[volume.picture].shot.author.name))];

  return (
    <>
      <ManualBar current="volume" />
      <div className="banner">
        <Picture name="manual" eager />
        <div className="banner-shade" aria-hidden="true" />
        <div className="wrap page-head manual-head">
          <ManualMark heading />
          <hr className="rule" />
          <p className="lead">How the 9th Fleet is organised and commanded, written down in one place.</p>
        </div>
      </div>

      <div className="wrap columns">
        <aside>
          <ManualNav current="/manual" />
        </aside>
        <div className="panel">
          <h2>
            <strong>Overview</strong>
          </h2>
          <dl className="figures">
            <div>
              <dt>Volumes planned</dt>
              <dd>{volumes.length}</dd>
            </div>
            <div>
              <dt>Published</dt>
              <dd>{published.length}</dd>
            </div>
            <div>
              <dt>In review</dt>
              <dd>{inReview}</dd>
            </div>
            <div>
              <dt>Sections to read</dt>
              <dd>{sections}</dd>
            </div>
          </dl>
          <p className="panel-note">
            A volume is published here once the Fleet Commander has reviewed it. Read it volume by volume, or by the
            post you hold under <Link href="/roles">By role</Link>.
          </p>

          <h2 className="panel-next">
            Latest <strong>changes</strong>
          </h2>
          <ol className="changes">
            {changes.map((change) => {
              const volume = volumes.find((entry) => entry.number === change.volume)!;
              return (
                <li key={`${change.when}-${change.volume}`}>
                  <p className="changes-when">
                    <span>{change.when}</span>
                    <StateChip state={volume.state} />
                  </p>
                  <h3>
                    Volume {volume.number}, {volume.title}
                  </h3>
                  <p>{change.what}</p>
                </li>
              );
            })}
          </ol>
        </div>
      </div>

      <section className="shelf" aria-labelledby="volumes">
        <div className="wrap">
          <h2 id="volumes">
            The ten <strong>volumes</strong>
          </h2>
          <ul className="volume-cards">
            {volumes.map((volume) => {
              const open = volume.state !== "planned";
              return (
                <li className={open ? "volume-card" : "volume-card volume-card-later"} key={volume.slug}>
                  <div className="volume-card-pic">
                    <Picture name={volume.picture} sizes="(max-width: 520px) 100vw, 300px" credit={false} />
                    <span className="volume-card-number" aria-hidden="true">
                      {volume.number}
                    </span>
                    <StateChip state={volume.state} />
                  </div>
                  <div className="volume-card-words">
                    <h3>
                      {open ? (
                        <Link href={`/manual/${volume.slug}`}>
                          <span className="visually-hidden">Volume {volume.number}: </span>
                          {volume.title}
                        </Link>
                      ) : (
                        <>
                          <span className="visually-hidden">Volume {volume.number}: </span>
                          {volume.title}
                        </>
                      )}
                    </h3>
                    <p>{volume.covers}</p>
                    <p className="volume-card-date">{volume.dated}</p>
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="shelf-credit">
            Pictures by {authors.join(" and ")}. <Link href="/credits">Picture credits</Link>
          </p>
        </div>
      </section>
    </>
  );
}
