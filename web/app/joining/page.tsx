import type { Metadata } from "next";
import Link from "next/link";
import { PageHead } from "@/components/PageHead";
import { Picture } from "@/components/Picture";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Joining",
  description: `How to join the UEE 9th Fleet. Recruitment opens on ${site.recruitmentOpens}.`,
};

const route = [
  { step: "Apply", time: "", detail: `On this site, from ${site.recruitmentOpens}.` },
  { step: "Interview", time: "15 minutes", detail: "A short conversation by voice." },
  {
    step: "Induction",
    time: "30 minutes",
    detail: "The values, the conduct rules, how operations run, and setting up the voice app.",
  },
  {
    step: "Common training",
    time: "45 minutes",
    detail: "Voice procedure, muster and the casualty drill. It ends with an assessed radio exchange.",
  },
  {
    step: "Branch training",
    time: "60 minutes",
    detail: "For the Navy: ship stations, emergency drills, turrets and damage control.",
  },
  {
    step: "Auxiliary",
    time: "",
    detail: "You can now join operations, filling a post that would be empty that night.",
  },
  {
    step: "Full member",
    time: "",
    detail: "After your first operation you may apply for any open entry post in your branch.",
  },
];

export default function JoiningPage() {
  return (
    <>
      <PageHead
        picture="joining"
        title={
          <>
            How joining <strong>works</strong>
          </>
        }
        lead={`Recruitment opens on ${site.recruitmentOpens}. From your application to your first operation takes about two and a half hours of interview and training.`}
      />

      <section className="wrap band" aria-labelledby="route">
        <h2 id="route">
          The route <strong>in</strong>
        </h2>
        <div className="beside">
          <ol className="sequence sequence-timed">
            {route.map((item) => (
              <li key={item.step}>
                <h3>{item.step}</h3>
                <p>{item.detail}</p>
                {item.time ? <p className="time">{item.time}</p> : null}
              </li>
            ))}
          </ol>
          <div className="beside-pic">
            <Picture name="route" sizes="(max-width: 900px) 100vw, 50vw" />
          </div>
        </div>
      </section>

      <section className="split split-reverse" aria-labelledby="officers">
        <div className="split-text">
          <h2 id="officers" className="title">
            Becoming an <strong>officer</strong>
          </h2>
          <p>
            Officers are trained on a cadet course that lasts about two months. You can apply for it as a member or
            when you first join.
          </p>
          <p>Rank belongs to the post you hold. You are promoted by earning a post, and you keep it by doing the job.</p>
        </div>
        <div className="split-pic">
          <Picture name="officers" sizes="(max-width: 960px) 100vw, 50vw" credit="top-left" />
        </div>
      </section>

      <section className="cta" aria-labelledby="until">
        <Picture name="apply" />
        <div className="wrap">
          <div className="cta-words">
            <h2 id="until" className="title">
              Until recruitment <strong>opens</strong>
            </h2>
            <p>There is nothing to sign yet. Read the standards, and come back on {site.recruitmentOpens}.</p>
          </div>
          <div className="cta-act">
            <Link className="button" href="/standards">
              Read the standards
            </Link>
            <span>Recruitment opens {site.recruitmentOpens}</span>
          </div>
        </div>
      </section>
    </>
  );
}
