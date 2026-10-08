import Link from "next/link";
import { Crest } from "@/components/Crest";
import { DaysUntil } from "@/components/DaysUntil";
import { Icon, type IconName } from "@/components/Icon";
import { Credit, Picture } from "@/components/Picture";
import { site } from "@/lib/site";

const facts: { icon: IconName; text: string }[] = [
  { icon: "ship", text: `${site.formation}, with the flagship ${site.flagship}` },
  { icon: "calendar", text: "Two fixed two-hour evenings a week, in UK time" },
  { icon: "chevrons", text: "Rank comes with the post you hold" },
  { icon: "radio", text: "The fleet's own voice app for the radio nets" },
];

const character: { icon: IconName; term: string; detail: string }[] = [
  {
    icon: "anchor",
    term: "A naval unit, run like one",
    detail: `${site.formation} sails from Stanton under one chain of command. You hold a post on a ship.`,
  },
  {
    icon: "radio",
    term: "Correct radio procedure",
    detail: "Operations run on radio nets with British voice procedure, on the fleet's own voice app.",
  },
  {
    icon: "checks",
    term: "Correct before fast",
    detail: "We muster, check radios and brief before every operation. If that means waiting, we wait.",
  },
  {
    icon: "chevrons",
    term: "Rank you earn",
    detail: "Rank belongs to the post you hold. You are promoted by earning a post, and you keep it by doing the job.",
  },
  {
    icon: "timer",
    term: "Trained before your first operation",
    detail:
      "About two and a half hours of interview and training take you from your application to your first operation.",
  },
  {
    icon: "people",
    term: "Friendly off duty",
    detail: "Ranks and callsigns are for operations and training. Everywhere else, people are themselves.",
  },
];

const route: { icon: IconName; step: string; detail: string }[] = [
  { icon: "pen", step: "Apply", detail: `On this site, from ${site.recruitmentOpens}. Answer four short questions.` },
  {
    icon: "headset",
    step: "Interview and induction",
    detail: "A 15-minute conversation by voice, then a 30-minute induction.",
  },
  { icon: "book", step: "Training", detail: "45 minutes of common training, then 60 minutes for your branch." },
  {
    icon: "ship",
    step: "First operation",
    detail: "You join operations as an auxiliary. After your first, you are a full member.",
  },
];

const work: { icon: IconName; term: string; detail: string }[] = [
  { icon: "globe", term: "Patrol.", detail: "A ship or a task group holds a sector and reports what it finds." },
  { icon: "flag", term: "Response.", detail: "We answer piracy reports sent in by other players." },
  { icon: "target", term: "Strike.", detail: "A planned operation against a declared hostile organisation." },
  { icon: "shield", term: "Training.", detail: "Ship drills, gunnery, and launch and recovery, every week." },
];

export default function FrontPage() {
  return (
    <>
      <section className="hero" aria-labelledby="hail">
        {/* A frame taller than the section, so the picture's sun sits behind the crest and not the name. */}
        <div className="hero-pic">
          <Picture name="hero" eager className="picture-drift" credit={false} />
        </div>
        <div className="hero-shade" aria-hidden="true" />
        <div className="wrap hero-content rise">
          <Crest className="hero-crest" />
          <h1 id="hail">{site.name}</h1>
          <p className="hero-motto">{site.motto}</p>
          <p className="actions hero-actions">
            <Link className="button button-dark button-big" href="/joining">
              <Icon name="pen" size={20} />
              How joining works
            </Link>
            <Link className="button button-big" href="/standards">
              <Icon name="book" size={20} />
              Read the standards
            </Link>
          </p>
        </div>
        <dl className="stats">
          <DaysUntil at={site.recruitmentOpensAt} label="Days to recruitment" />
          <div>
            <dt>Stage of nine</dt>
            <dd>{site.stage}</dd>
          </div>
          <div>
            <dt>Posts open now</dt>
            <dd>{site.postsOpen}</dd>
          </div>
          <div>
            <dt>Nights a week</dt>
            <dd>2</dd>
          </div>
          <div>
            <dt>Hours of training to join</dt>
            <dd>2&frac12;</dd>
          </div>
        </dl>
        <p className="hero-more">
          <a href="#intro">
            Explore the fleet
            <Icon name="down" size={22} />
          </a>
        </p>
        <Credit name="hero" corner="bottom-right" />
      </section>

      <section id="intro" className="split" aria-labelledby="h-intro">
        <div className="split-text">
          <h2 id="h-intro" className="title">
            Introducing the <strong>9th Fleet</strong>
          </h2>
          <p>
            The 9th Fleet is a UEE Navy formation in Stanton. Its job is anti-piracy and the protection of UEE systems.
            Every member has a post, every operation has orders, and nothing steps off until the checks are done.
          </p>
          <ul className="checklist">
            {facts.map((item) => (
              <li key={item.text}>
                <Icon name={item.icon} size={20} />
                {item.text}
              </li>
            ))}
          </ul>
        </div>
        <div className="split-pic">
          <Picture name="intro" sizes="(max-width: 960px) 100vw, 50vw" />
        </div>
      </section>

      <section className="over" aria-labelledby="h-why">
        <Picture name="why" />
        <div className="over-shade" aria-hidden="true" />
        <div className="wrap">
          <div className="centred">
            <h2 id="h-why" className="title">
              Why the <strong>9th Fleet</strong>?
            </h2>
            <p>
              We crew UEE Navy ships properly: one chain of command, correct radio procedure, and operations that start
              when the checks are done.
            </p>
          </div>
          <ul className="cards">
            {character.map((item) => (
              <li className="card" key={item.term}>
                <Icon name={item.icon} size={30} />
                <h3>{item.term}</h3>
                <p>{item.detail}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="hail" aria-label="The fleet's hail">
        <Picture name="hail" />
        <p>
          Hello all stations,
          <br />
          this is the <em>9th Fleet</em>.
        </p>
      </section>

      <section className="steps-band" aria-labelledby="h-route">
        <div className="wrap">
          <div className="centred">
            <h2 id="h-route" className="title">
              How joining <strong>works</strong>
            </h2>
          </div>
          <ol className="steps">
            {route.map((item) => (
              <li className="step" key={item.step}>
                <span className="step-icon" aria-hidden="true">
                  <Icon name={item.icon} />
                </span>
                <div>
                  <h3>{item.step}</h3>
                  <p>{item.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="split split-reverse" aria-labelledby="h-work">
        <div className="split-text">
          <h2 id="h-work" className="title">
            What <strong>we do</strong>
          </h2>
          <p>The fleet&apos;s job is to keep UEE space safe from piracy.</p>
          <ul className="checklist">
            {work.map((item) => (
              <li key={item.term}>
                <Icon name={item.icon} size={20} />
                <span>
                  <strong>{item.term}</strong> {item.detail}
                </span>
              </li>
            ))}
          </ul>
          <p className="small">
            We engage declared hostile organisations, known pirates on evidence, and wanted players who refuse a
            challenge. Against everyone else we fire only in self-defence.
          </p>
        </div>
        <div className="split-pic">
          <Picture name="work" sizes="(max-width: 960px) 100vw, 50vw" credit="top-left" />
        </div>
      </section>

      <section className="cta" aria-labelledby="h-next">
        <Picture name="apply" />
        <div className="wrap">
          <div className="cta-words">
            <h2 id="h-next" className="title">
              Before you <strong>apply</strong>
            </h2>
            <p>Read what the fleet expects of its members, then how joining works.</p>
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
