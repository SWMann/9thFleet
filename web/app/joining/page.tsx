import type { Metadata } from "next";
import Link from "next/link";
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
  { step: "Auxiliary", time: "", detail: "You can now fill support slots on most operations." },
  {
    step: "Full member",
    time: "",
    detail: "After your first operation you may apply for any open entry post in your branch.",
  },
];

export default function JoiningPage() {
  return (
    <>
      <div className="wrap page-head">
        <h1>How joining works</h1>
        <p className="lead">
          Recruitment opens on {site.recruitmentOpens}. From your application to your first operation takes about two
          and a half hours of interview and training.
        </p>
      </div>

      <section className="wrap band" aria-labelledby="route">
        <h2 id="route">The route in</h2>
        <ol className="sequence sequence-timed">
          {route.map((item) => (
            <li key={item.step}>
              <h3>{item.step}</h3>
              <p>{item.detail}</p>
              {item.time ? <p className="time">{item.time}</p> : null}
            </li>
          ))}
        </ol>
      </section>

      <section className="wrap band" aria-labelledby="officers">
        <h2 id="officers">Becoming an officer</h2>
        <div className="prose">
          <p>
            Officers are trained on a cadet course that lasts about two months. You can apply for it as a member or
            when you first join.
          </p>
          <p>Rank belongs to the post you hold. You are promoted by earning a post, and you keep it by doing the job.</p>
        </div>
      </section>

      <section className="wrap band band-last" aria-labelledby="until">
        <h2 id="until">Until recruitment opens</h2>
        <div>
          <p className="intro">There is nothing to sign yet. Read the standards, and come back on {site.recruitmentOpens}.</p>
          <p className="actions">
            <Link className="button" href="/standards">
              Read the standards
            </Link>
          </p>
        </div>
      </section>
    </>
  );
}
