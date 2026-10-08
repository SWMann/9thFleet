import type { Metadata } from "next";
import Image from "next/image";
import { PageHead } from "@/components/PageHead";
import { fanKitPage, shots } from "@/lib/pictures";

export const metadata: Metadata = {
  title: "Picture credits",
  description: "Who made the Star Citizen pictures on this site, and the licences they are used under.",
};

export default function CreditsPage() {
  const all = Object.values(shots);
  const fromPlayers = all.filter((shot) => shot.source === "flickr");
  const fromTheKit = all.filter((shot) => shot.source === "fankit");
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
        lead="The pictures on this site are Star Citizen screenshots that players published for others to use, and wallpapers from Cloud Imperium's fan kit."
      />

      <section className="wrap band" aria-labelledby="players">
        <h2 id="players">
          From <strong>players</strong>
        </h2>
        <p className="intro">
          Each one is used under the Creative Commons licence its author chose, which asks for the author to be named
          and bars commercial use. They are shown resized and cropped, and some sit behind a dark tint. Thank you to
          every one of them.
        </p>
        <ul className="shots">
          {fromPlayers.map((shot) => (
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
          If a picture of yours is here and you would rather it were not, tell the fleet&apos;s staff and it will be
          taken down.
        </p>
      </section>

      <section className="wrap band band-last" aria-labelledby="kit">
        <h2 id="kit">
          From the <strong>fan kit</strong>
        </h2>
        <p className="intro">
          These wallpapers are Cloud Imperium&apos;s, from the <a href={fanKitPage}>Star Citizen fan kit</a>, and are
          used under its Fankit Agreement. They are shown whole, with their watermark, and changed only in size.
        </p>
        <ul className="shots">
          {fromTheKit.map((shot) => (
            <li className="shot" id={`shot-${shot.id}`} key={shot.id}>
              <div className="shot-pic">
                <Image src={shot.image} alt="" fill sizes="(max-width: 700px) 100vw, 360px" />
              </div>
              <div className="shot-words">
                <p className="shot-title">{shot.title}</p>
                <p>
                  By <a href={shot.author.url}>{shot.author.name}</a>
                </p>
                <p>
                  Used under the <a href={shot.licence.url}>{shot.licence.name}</a>
                </p>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
