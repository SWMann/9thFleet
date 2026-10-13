import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/Icon";
import { PageHead } from "@/components/PageHead";
import { KEEP_MONTHS } from "@/lib/piracy-form";
import { ReportForm } from "./ReportForm";

export const metadata: Metadata = {
  title: "Report piracy",
  description: "Tell the 9th Fleet about piracy in UEE space: who attacked you, where and when. Anyone may send a report.",
};

/**
 * The public report line. Anyone may send a report, signed in or not, and the
 * page is the same for everyone: it reads nothing about its reader.
 */
export default function ReportPiracyPage() {
  return (
    <>
      <PageHead
        picture="hail"
        slim
        title={
          <>
            Report <strong>piracy</strong>
          </>
        }
        lead="Attacked by pirates in UEE space? Tell the 9th Fleet who, where and when. You do not need to be a member or to sign in."
      />

      <section className="wrap band" aria-labelledby="before-sending">
        <h2 id="before-sending">
          Before you <strong>send</strong>
        </h2>
        <p className="notice">
          <Icon name="warning" size={16} />
          This is not an emergency line. Help is not guaranteed, and it may not come in time.
        </p>
        <dl className="facts">
          <div>
            <dt>Who answers</dt>
            <dd>
              The fleet is run by players in their own time. Nobody is sent a message when a report arrives: command sees it the next
              time one of them opens the fleet&apos;s pages on this site. The line takes a limited number of reports each hour and each
              day, and says so when it is full.
            </dd>
          </div>
          <div>
            <dt>What may follow</dt>
            <dd>
              Command may send a ship, add the attacker to the fleet&apos;s list of hostile players, or do nothing. A member of the fleet
              may contact your handle in the game. There is no reply through this site.
            </dd>
          </div>
          <div>
            <dt>Game names only</dt>
            <dd>
              Give handles as the game shows them. Do not write a real name, an address, or anything else about a person outside the
              game, yours or anyone&apos;s.
            </dd>
          </div>
          <div>
            <dt>Who reads it</dt>
            <dd>
              Fleet command and nobody else. If the fleet acts on a report, command tells its members what they need to know in the
              game: the attacker&apos;s name, what was done, and the links you gave. A report is never published, and after{" "}
              {KEEP_MONTHS} months nobody can read it. <Link href="/privacy#reporting">What this site records</Link> says the rest.
            </dd>
          </div>
          <div>
            <dt>One side of a story</dt>
            <dd>Command checks a report before it acts on one. Say what you saw, and link a screenshot or a clip if you have one.</dd>
          </div>
        </dl>
      </section>

      <section className="wrap band band-last" aria-labelledby="the-report">
        <h2 id="the-report">
          Your <strong>report</strong>
        </h2>
        <ReportForm />
      </section>
    </>
  );
}
