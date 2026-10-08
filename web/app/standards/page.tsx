import type { Metadata } from "next";
import Link from "next/link";
import { Icon, type IconName } from "@/components/Icon";
import { PageHead } from "@/components/PageHead";
import { Picture } from "@/components/Picture";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Standards",
  description: "The six values the UEE 9th Fleet holds its members to, what you need to join, and who the fleet fights.",
};

const values: { icon: IconName; term: string; detail: string }[] = [
  { icon: "people", term: "Teamwork", detail: "You fill your post and back the person next to you before chasing a kill." },
  {
    icon: "radio",
    term: "Communication",
    detail: "You use the net correctly, briefly, and only when you have something to send.",
  },
  { icon: "target", term: "Precision", detail: "You do the drill as written, including the checks." },
  { icon: "calendar", term: "Diligence", detail: "You turn up when you signed up, prepared and in the right kit." },
  {
    icon: "heart",
    term: "Friendly",
    detail: "You are easy company off duty, and on duty you correct people without contempt.",
  },
  {
    icon: "star",
    term: "Passionate",
    detail: "You care enough to practise, to debrief truthfully and to teach the next person.",
  },
];

const needs: { icon: IconName; term: string; detail: string }[] = [
  { icon: "person", term: "Age", detail: "You are 18 or over." },
  { icon: "mic", term: "Microphone", detail: "You have one that works, and you are willing to use it." },
  {
    icon: "screen",
    term: "Computer",
    detail: "You play Star Citizen on a Windows PC. The fleet voice app runs on Windows.",
  },
  {
    icon: "clock",
    term: "Time",
    detail: "The fleet runs two fixed two-hour evenings a week in UK time: one for training and one for operations.",
  },
];

const targets: { icon: IconName; term: string; detail: string }[] = [
  { icon: "flag", term: "Declared hostile", detail: "Organisations the Fleet Commander has declared hostile." },
  { icon: "book", term: "Known pirates", detail: "Individual pirates the fleet holds evidence against." },
  { icon: "target", term: "Wanted players", detail: "Wanted players who refuse to stop when challenged." },
];

export default function StandardsPage() {
  return (
    <>
      <PageHead
        picture="standards"
        title={
          <>
            What the fleet <strong>expects</strong>
          </>
        }
        lead="Six values decide who joins, who leads and who stays. Each one is something you can be seen doing on an operation."
      />

      <section className="wrap band" aria-labelledby="values">
        <h2 id="values">
          The six <strong>values</strong>
        </h2>
        <dl className="cards">
          {values.map((item) => (
            <div className="card" key={item.term}>
              <Icon name={item.icon} size={30} />
              <dt>{item.term}</dt>
              <dd>{item.detail}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="wrap band" aria-labelledby="needs">
        <h2 id="needs">
          What you <strong>need</strong>
        </h2>
        <dl className="cards cards-four">
          {needs.map((item) => (
            <div className="card" key={item.term}>
              <Icon name={item.icon} size={30} />
              <dt>{item.term}</dt>
              <dd>{item.detail}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="split" aria-labelledby="duty">
        <div className="split-text">
          <h2 id="duty" className="title">
            On duty and <strong>off</strong>
          </h2>
          <p>
            On operations and in training the fleet is in character. You use your rank, your callsign and the
            fleet&apos;s uniform, and orders come down one chain of command.
          </p>
          <p>Off duty nobody outranks anybody. The conduct rules apply all the time.</p>
        </div>
        <div className="split-pic">
          <Picture name="duty" sizes="(max-width: 960px) 100vw, 50vw" />
        </div>
      </section>

      <section className="wrap band" aria-labelledby="engage">
        <h2 id="engage">
          Who the fleet <strong>fights</strong>
        </h2>
        <p className="intro">The fleet may engage three kinds of target.</p>
        <dl className="cards">
          {targets.map((item) => (
            <div className="card" key={item.term}>
              <Icon name={item.icon} size={30} />
              <dt>{item.term}</dt>
              <dd>{item.detail}</dd>
            </div>
          ))}
        </dl>
        <p className="after-cards">
          A wanted player is challenged by text and by voice, given time to comply and warned once before the fleet
          acts. Against everyone else we fire only in self-defence.
        </p>
      </section>

      <section className="cta" aria-labelledby="next">
        <Picture name="apply" />
        <div className="wrap">
          <div className="cta-words">
            <h2 id="next" className="title">
              If this is <strong>for you</strong>
            </h2>
            <p>See how an application becomes a post on a ship.</p>
          </div>
          <div className="cta-act">
            <Link className="button" href="/joining">
              How joining works
            </Link>
            <span>Recruitment opens {site.recruitmentOpens}</span>
          </div>
        </div>
      </section>
    </>
  );
}
