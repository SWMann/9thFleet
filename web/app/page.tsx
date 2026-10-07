import Link from "next/link";
import { HullMark } from "@/components/HullMark";
import { site } from "@/lib/site";

const character = [
  {
    term: "A naval unit, run like one",
    detail: `${site.formation} sails from Stanton under one chain of command. You hold a post on a ship, and your rank comes with the post.`,
  },
  {
    term: "Correct radio procedure",
    detail:
      "Operations run on radio nets with British voice procedure, on the fleet's own voice app. You speak when you have something to send.",
  },
  {
    term: "Correct before fast",
    detail: "We muster, check radios and brief before every operation. If that means waiting, we wait.",
  },
  {
    term: "Friendly off duty",
    detail: "Ranks and callsigns are for operations and training. Everywhere else, people are themselves.",
  },
];

const work = [
  { term: "Patrol", detail: "A ship or a task group holds a sector of Stanton and reports what it finds." },
  { term: "Response", detail: "We answer piracy reports sent in by other players." },
  { term: "Strike", detail: "A planned operation against a declared hostile organisation." },
  { term: "Training", detail: "Ship drills, gunnery, and launch and recovery, every week." },
];

const night = [
  { step: "Warning order", detail: "Three days before, you get the task and the time." },
  { step: "Attendance", detail: "You confirm whether you are coming. The roll closes the day before." },
  { step: "Muster", detail: "Fifteen minutes before: attendance, kit, and a radio check on every net." },
  { step: "Orders", detail: "The commander briefs the plan in five paragraphs." },
  { step: "The operation", detail: "Two hours, on the nets." },
  { step: "Debrief", detail: "Ten minutes on what happened, what to keep and what to change." },
];

const services = [
  { term: "Navy", detail: "Ships, turrets, engineering and flight.", state: "Opens at launch" },
  { term: "Army", detail: "Ground operations.", state: "Opens as the fleet grows" },
  { term: "Marines", detail: "Boarding and ship security.", state: "Opens as the fleet grows" },
];

export default function FrontPage() {
  return (
    <>
      <section className="hull" aria-labelledby="hail">
        <div className="wrap hull-grid">
          <div className="hull-content">
            <h1 id="hail">
              Hello all stations,
              <br />
              this is the 9th&nbsp;Fleet.
            </h1>
            <p className="lead">
              We are a Star Citizen organisation that crews UEE Navy ships properly. Every member has a post, every
              operation has orders, and nothing steps off until the checks are done.
            </p>
            <div className="signal">
              <p>Recruitment opens on {site.recruitmentOpens}.</p>
              <Link className="button" href="/joining">
                How joining works
              </Link>
            </div>
          </div>
          <HullMark className="hull-mark" />
        </div>
      </section>

      <section className="wrap band" aria-labelledby="character">
        <h2 id="character">What the fleet is</h2>
        <dl className="ledger">
          {character.map((item) => (
            <div key={item.term}>
              <dt>{item.term}</dt>
              <dd>{item.detail}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="wrap band" aria-labelledby="work">
        <h2 id="work">What we do</h2>
        <div>
          <p className="intro">The fleet&apos;s job is to keep UEE space safe from piracy.</p>
          <dl className="ledger ledger-tight">
            {work.map((item) => (
              <div key={item.term}>
                <dt>{item.term}</dt>
                <dd>{item.detail}</dd>
              </div>
            ))}
          </dl>
          <p>
            We engage declared hostile organisations, known pirates on evidence, and wanted players who refuse a
            challenge. Against everyone else we fire only in self-defence.
          </p>
        </div>
      </section>

      <section className="wrap band" aria-labelledby="night">
        <h2 id="night">An operation night</h2>
        <ol className="sequence">
          {night.map((item) => (
            <li key={item.step}>
              <h3>{item.step}</h3>
              <p>{item.detail}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="wrap band" aria-labelledby="services">
        <h2 id="services">Three services</h2>
        <div>
          <p className="intro">
            The Navy opens first, with the flagship {site.flagship}. The Army and the Marines follow.
          </p>
          <dl className="ledger ledger-tight ledger-state">
            {services.map((item) => (
              <div key={item.term}>
                <dt>{item.term}</dt>
                <dd>{item.detail}</dd>
                <dd className="state">{item.state}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="wrap band band-last" aria-labelledby="next">
        <h2 id="next">Before you apply</h2>
        <div>
          <p className="intro">Read what the fleet expects of its members, then how joining works.</p>
          <p className="actions">
            <Link className="button" href="/standards">
              Read the standards
            </Link>
            <Link className="button button-quiet" href="/joining">
              How joining works
            </Link>
          </p>
        </div>
      </section>
    </>
  );
}
