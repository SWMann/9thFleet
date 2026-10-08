import type { Metadata } from "next";
import Image from "next/image";
import { PageHead } from "@/components/PageHead";
import { shots } from "@/lib/pictures";

export const metadata: Metadata = {
  title: "Picture credits",
  description: "Who took the Star Citizen screenshots on this site, and the licences they are used under.",
};

export default function CreditsPage() {
  const all = Object.values(shots);
  return (
    <>
      <PageHead
        picture="lost"
        slim
        title={
          <>
            Picture <strong>credits</strong>
          </>
        }
        lead="The pictures on this site are Star Citizen screenshots taken by players, who published them for others to use."
      />

      <section className="wrap band band-last" aria-labelledby="pictures">
        <h2 id="pictures">
          The <strong>pictures</strong>
        </h2>
        <p className="intro">
          Each one is used under the Creative Commons licence its author chose, which asks for the author to be named
          and bars commercial use. They are shown resized and cropped, and some sit behind a dark tint. Thank you to
          every one of them.
        </p>
        <ul className="shots">
          {all.map((shot) => (
            <li className="shot" id={`shot-${shot.id}`} key={shot.id}>
              <div className="shot-pic">
                <Image src={shot.image} alt="" fill sizes="(max-width: 700px) 100vw, 360px" placeholder="blur" />
              </div>
              <div className="shot-words">
                <p className="shot-title">
                  <a href={shot.page}>{shot.title}</a>
                </p>
                <p>
                  By <a href={shot.author.url}>{shot.author.name}</a>, on Flickr
                </p>
                <p>
                  Licence: <a href={shot.licence.url}>{shot.licence.name}</a>
                </p>
              </div>
            </li>
          ))}
        </ul>
        <p className="after-cards">
          A picture under a share-alike licence is offered here, as resized, under that same licence. If a picture of
          yours is here and you would rather it were not, tell the fleet&apos;s staff and it will be taken down.
        </p>
      </section>
    </>
  );
}
