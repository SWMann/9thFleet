import type { Metadata } from "next";
import Link from "next/link";
import { PageHead } from "@/components/PageHead";
import { KEEP_MONTHS } from "@/lib/piracy-form";

export const metadata: Metadata = {
  title: "What this site records",
  description: "What the 9th Fleet's site keeps about visitors, members and players it names, who can read it, and how to have it removed.",
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
        lead="What is kept about visitors, members and players the fleet names, who can read it, and how to have it removed."
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

      <section className="wrap band" aria-labelledby="reporting">
        <h2 id="reporting">
          If you <strong>report piracy</strong>
        </h2>
        <div className="prose">
          <p>
            Anyone may send the fleet a <Link href="/piracy">piracy report</Link> without signing in. It is read by fleet command and
            nobody else, and it is never published.
          </p>
          <ul>
            <li>
              <strong>What is kept.</strong> What you typed: your handle in the game, where and when it happened, who you say did it,
              what they did, and any web addresses you gave. With it, the time the report arrived.
            </li>
            <li>
              <strong>What is not kept.</strong> Your network address, and anything about your browser.
            </li>
            <li>
              <strong>The sender&apos;s mark.</strong> So that one sender cannot flood the line, the site works out a mark of four
              characters from your network address and the day. The database keeps the mark, the day and how many reports the mark
              has sent that day. It does not keep the mark with your report. About 65,000 addresses share each mark and yours
              changes every day, so a mark does not say whose it is. The marks of earlier days are deleted when the next report
              arrives.
            </li>
            <li>
              <strong>How long.</strong> A report can be read for {KEEP_MONTHS} months after it arrives, unless command deletes it
              sooner. After that nobody can read it, and it is deleted from the database the next time the line is used. Its words
              go from the log of changes at the same time.
            </li>
            <li>
              <strong>What may come of it.</strong> Command may put the player or organisation you named on the fleet&apos;s hostile
              list. That entry may repeat what you wrote and the links you gave, though not your handle unless command adds it. It
              is read by the serving fleet and kept under the list&apos;s own rules, after your report is gone. Command may also tell
              the fleet&apos;s members what they need to know in the game to answer your report.
            </li>
          </ul>
        </div>
      </section>

      <section className="wrap band" aria-labelledby="named">
        <h2 id="named">
          If the fleet has <strong>named you</strong>
        </h2>
        <div className="prose">
          <p>The fleet keeps two records that can name a player who has nothing to do with this site.</p>
          <ul>
            <li>
              <strong>The hostile list.</strong> The players and organisations the fleet treats as hostile in the game. An entry holds a
              handle or an organisation ID as the game shows it, what the fleet says was done in the game, links to a screenshot or a
              clip, and who in the fleet put it forward and decided it. It holds nothing about anyone outside the game. The serving
              fleet reads it, and it is never published. An entry for a player lapses after 90 days unless command renews it.
            </li>
            <li>
              <strong>Piracy reports.</strong> A report may give the handle of whoever its sender says attacked them. Command alone reads
              it, and after {KEEP_MONTHS} months nobody can.
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
              qualifications, any application and its answers, your replies to events and whether you attended. You can download it as a
              file from your record page.
            </li>
            <li>
              <strong>Your calendar address.</strong> If you make one, a private key that lets a calendar app read your events and your
              replies to them without signing in. Anyone who has the address can read them until you make a new one. The log of changes
              does not hold the key.
            </li>
            <li>
              <strong>Monthly returns.</strong> On the first of each month the database records how many were serving, joined and left,
              how many hulls were ready, and how many events were held and attended. Figures only; no names.
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
            <dd>
              Each other&apos;s names, ranks, posts and qualifications, the events, who said they are attending, who is mentioned in an
              event&apos;s report, the hostile list as it stands today, the training syllabus, the ship register (each hull, its name, its
              owner and whether it is marked ready, not ready or in claim, and what is offered for each event), and routine orders, which name who was appointed,
              promoted and qualified, who joined and left, and which names were declared hostile or placed on watch.
            </dd>
          </div>
          <div>
            <dt>Staff and command</dt>
            <dd>
              Everyone&apos;s record and Discord name, applications and their answers, interview notes except on their own, and who
              attended each event or was absent.
            </dd>
          </div>
          <div>
            <dt>Instructors, staff and command</dt>
            <dd>Which lessons each member has passed, when, and which instructor signed each off. A member sees their own.</dd>
          </div>
          <div>
            <dt>Command</dt>
            <dd>
              Piracy reports. Names put forward for the hostile list, and entries that were declined, lifted or have lapsed, which
              whoever put a name forward also sees. Who has marked each issue of routine orders as read. The note an owner writes on
              a ship, which the owner also sees.
            </dd>
          </div>
          <div>
            <dt>Whoever ran an event</dt>
            <dd>Who attended it and who was absent, and who has acknowledged a change to its orders.</dd>
          </div>
          <div>
            <dt>Command and an opposing force</dt>
            <dd>Who is on an exercise&apos;s opposing force, and its plan. Nobody else is shown either.</dd>
          </div>
          <div>
            <dt>The fleet&apos;s Discord channel</dt>
            <dd>
              When an event is announced: its type, its title, when it starts and a link to it. Nobody&apos;s name is in the
              post, and the orders stay on this site.
            </dd>
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
            qualifications, lessons passed, mentions, your ships and their notes, your lines on every roll and your lines in the
            activity log. Where an issue of routine orders named
            you, it says &ldquo;a former member&rdquo; instead. The log of changes keeps a line saying that something changed and when,
            with what it held about you blanked.
          </p>
          <p>You can also ask to see what is held about you, or to have a mistake put right.</p>
          <p>
            That goes for someone who is not a member too. If you sent a piracy report, or believe a report or the hostile list names
            you, ask the fleet&apos;s command to show you what is held, to correct it or to delete it. Deleting a report or an entry
            removes its words from the log of changes as well.
          </p>
        </div>
      </section>
    </>
  );
}
