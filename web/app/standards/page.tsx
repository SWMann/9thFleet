import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Standards",
  description: "The six values the UEE 9th Fleet holds its members to, what you need to join, and who the fleet fights.",
};

const values = [
  { term: "Teamwork", detail: "You fill your post and back the person next to you before chasing a kill." },
  { term: "Communication", detail: "You use the net correctly, briefly, and only when you have something to send." },
  { term: "Precision", detail: "You do the drill as written, including the checks." },
  { term: "Diligence", detail: "You turn up when you signed up, prepared and in the right kit." },
  { term: "Friendly", detail: "You are easy company off duty, and on duty you correct people without contempt." },
  { term: "Passionate", detail: "You care enough to practise, to debrief truthfully and to teach the next person." },
];

const needs = [
  { term: "Age", detail: "You are 18 or over." },
  { term: "Microphone", detail: "You have one that works, and you are willing to use it." },
  { term: "Computer", detail: "You play Star Citizen on a Windows PC. The fleet voice app runs on Windows." },
  {
    term: "Time",
    detail: "The fleet runs two fixed two-hour evenings a week in UK time: one for training and one for operations.",
  },
];

export default function StandardsPage() {
  return (
    <>
      <div className="wrap page-head">
        <h1>What the fleet expects</h1>
        <p className="lead">
          Six values decide who joins, who leads and who stays. Each one is something you can be seen doing on an
          operation.
        </p>
      </div>

      <section className="wrap band" aria-labelledby="values">
        <h2 id="values">The six values</h2>
        <dl className="ledger ledger-tight">
          {values.map((item) => (
            <div key={item.term}>
              <dt>{item.term}</dt>
              <dd>{item.detail}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="wrap band" aria-labelledby="needs">
        <h2 id="needs">What you need</h2>
        <dl className="ledger ledger-tight">
          {needs.map((item) => (
            <div key={item.term}>
              <dt>{item.term}</dt>
              <dd>{item.detail}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="wrap band" aria-labelledby="duty">
        <h2 id="duty">On duty and off</h2>
        <div className="prose">
          <p>
            On operations and in training the fleet is in character. You use your rank, your callsign and the
            fleet&apos;s uniform, and orders come down one chain of command.
          </p>
          <p>Off duty nobody outranks anybody. The conduct rules apply all the time.</p>
        </div>
      </section>

      <section className="wrap band" aria-labelledby="engage">
        <h2 id="engage">Who the fleet fights</h2>
        <div className="prose">
          <p>The fleet may engage three kinds of target:</p>
          <ul>
            <li>organisations the Fleet Commander has declared hostile</li>
            <li>individual pirates the fleet holds evidence against</li>
            <li>wanted players who refuse to stop when challenged</li>
          </ul>
          <p>
            A wanted player is challenged by text and by voice, given time to comply and warned once before the fleet
            acts. Against everyone else we fire only in self-defence.
          </p>
        </div>
      </section>

      <section className="wrap band band-last" aria-labelledby="next">
        <h2 id="next">If this is for you</h2>
        <div>
          <p className="actions">
            <Link className="button" href="/joining">
              How joining works
            </Link>
          </p>
        </div>
      </section>
    </>
  );
}
