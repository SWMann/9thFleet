import type { Metadata } from "next";
import { PageHead } from "@/components/PageHead";

export const metadata: Metadata = {
  title: "What this site records",
  description: "What the 9th Fleet's site keeps about visitors and members, who can read it, and how to have it removed.",
};

/**
 * A plain account of what the site keeps. It describes what the code does, so
 * change it whenever the logging or the sign-in changes.
 */
export default function PrivacyPage() {
  return (
    <>
      <PageHead
        picture="lost"
        slim
        title={
          <>
            What this site <strong>records</strong>
          </>
        }
        lead="What is kept about visitors and members, who can read it, and how to have it removed."
      />

      <section className="wrap band" aria-labelledby="reading">
        <h2 id="reading">
          If you only <strong>read</strong> the site
        </h2>
        <div className="prose">
          <p>The site sets no cookies for a visitor and keeps nothing that says who you are.</p>
          <ul>
            <li>
              <strong>Page counts.</strong> Each public page has a running total for each day: how many times it was read, and how many
              visits began there. A total is a number against a page and a day. No address, browser or time of day is kept with it.
            </li>
            <li>
              <strong>Not counted.</strong> Browsers that ask not to be tracked, and robots that say what they are.
            </li>
            <li>
              <strong>The companies that run it.</strong> The site is served by Vercel and its database is kept by Supabase. Like any web
              host, they handle each request and keep their own short technical logs.
            </li>
          </ul>
        </div>
      </section>

      <section className="wrap band" aria-labelledby="signing-in">
        <h2 id="signing-in">
          If you <strong>sign in</strong>
        </h2>
        <div className="prose">
          <p>You sign in with Discord. The fleet never sees your Discord password.</p>
          <ul>
            <li>
              <strong>From Discord.</strong> Your Discord ID, display name, picture and email address reach the sign-in service. The
              fleet&apos;s records keep the ID and the display name. The email address stays in the sign-in service. It is not shown to
              anyone in the fleet and is not used to write to you.
            </li>
            <li>
              <strong>Cookies.</strong> A session cookie keeps you signed in, and scripts cannot read it. Two more hold no secret: one says
              you are signed in, and one says whether to show the admin pages in the menu.
            </li>
            <li>
              <strong>Your record.</strong> The character name and RSI handle you give, your status, service, rank, posts and
              qualifications, any application and its answers, your replies to events and whether you attended.
            </li>
          </ul>
        </div>
      </section>

      <section className="wrap band" aria-labelledby="logs">
        <h2 id="logs">
          The <strong>logs</strong>
        </h2>
        <div className="prose">
          <p>A strict unit keeps a record of what was done and by whom. Two logs do that.</p>
          <ul>
            <li>
              <strong>Changes.</strong> Every change to a record is kept with who made it, when, and what it was before and after. What an
              interview note said is left out.
            </li>
            <li>
              <strong>Activity.</strong> Each time you sign in or out, and anything you tried that was refused or failed, with what you
              were told.
            </li>
          </ul>
          <p>Which pages a member reads is not recorded.</p>
        </div>
      </section>

      <section className="wrap band" aria-labelledby="readers">
        <h2 id="readers">
          Who can read <strong>what</strong>
        </h2>
        <dl className="facts">
          <div>
            <dt>Anyone</dt>
            <dd>The fleet&apos;s units, posts and ranks. Never who holds a post.</dd>
          </div>
          <div>
            <dt>The serving fleet</dt>
            <dd>Each other&apos;s names, ranks, posts and qualifications, the events, and who said they are attending.</dd>
          </div>
          <div>
            <dt>Staff and command</dt>
            <dd>
              Everyone&apos;s record and Discord name, applications and their answers, interview notes except on their own, and who
              attended each event or was absent.
            </dd>
          </div>
          <div>
            <dt>Whoever ran an event</dt>
            <dd>Who attended it and who was absent.</dd>
          </div>
          <div>
            <dt>Admins</dt>
            <dd>The logs and the page counts.</dd>
          </div>
        </dl>
      </section>

      <section className="wrap band band-last" aria-labelledby="removing">
        <h2 id="removing">
          Having it <strong>removed</strong>
        </h2>
        <div className="prose">
          <p>
            Ask the fleet&apos;s staff to delete your record. That removes your account details, applications, appointments,
            qualifications, your lines on every roll and your lines in the activity log. The log of changes keeps a line saying that
            something changed and when, with what it held about you blanked.
          </p>
          <p>You can also ask to see what is held about you, or to have a mistake put right.</p>
        </div>
      </section>
    </>
  );
}
