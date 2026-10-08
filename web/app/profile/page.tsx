import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getSession, isStaff, type Member, type Role, type Service, type Status } from "@/lib/member";
import { site } from "@/lib/site";
import { signOut } from "./actions";
import { NamesForm } from "./NamesForm";
import { PageHead } from "@/components/PageHead";

export const metadata: Metadata = {
  title: "Your record",
  robots: { index: false, follow: false },
};

export default function ProfilePage() {
  return (
    <Suspense fallback={<Waiting />}>
      <Record />
    </Suspense>
  );
}

const yourRecord = (
  <>
    Your <strong>record</strong>
  </>
);

function Waiting() {
  return (
    <PageHead picture="members" slim title={yourRecord} lead="Reading your record." />
  );
}

const serviceNames: Record<Service, string> = { navy: "Navy", army: "Army", marines: "Marines" };

const statusNames: Record<Status, { name: string; meaning: string }> = {
  applicant: { name: "Applicant", meaning: "You have signed in. You have not joined the fleet." },
  recruit: { name: "Recruit", meaning: "Your application was accepted and you are in training." },
  auxiliary: {
    name: "Auxiliary",
    meaning: "You are trained. You join operations as a stand-in until your first one is done.",
  },
  member: { name: "Full member", meaning: "You are a full member and hold no post at the moment." },
  reserve: { name: "Reserve", meaning: "You are away. Your qualifications and record are kept." },
  discharged: { name: "Discharged", meaning: "You have left the fleet." },
};

const roleNames: Record<Role, string> = {
  instructor: "Instructor",
  staff: "Staff",
  command: "Command",
  admin: "Admin",
};

async function Record() {
  const session = await getSession();

  if (session.state === "signed-out") redirect("/sign-in");

  if (session.state === "no-database") {
    return (
      <PageHead picture="members" slim title={yourRecord} lead="This site is not connected to the fleet's database yet." />
    );
  }

  if (session.state === "no-record") {
    return (
      <PageHead
        picture="members"
        slim
        title={<strong>No record</strong>}
        lead="You are signed in, but not with Discord, so the fleet has no record for this account. Sign out and sign in with Discord."
      >
        <SignOut />
      </PageHead>
    );
  }

  const { member, recruitmentOpen } = session;
  const status = statusNames[member.status];

  return (
    <>
      <PageHead
        picture="members"
        slim
        title={<strong>{heading(member)}</strong>}
        lead={member.postTitle ? `${member.postTitle}, ${member.unitName}.` : status.meaning}
      />

      <section className="wrap band" aria-labelledby="standing">
        <h2 id="standing">Where you stand</h2>
        <dl className="facts">
          <Line label="Status" value={status.name} />
          <Line label="Service" value={member.service ? serviceNames[member.service] : "Not set"} />
          <Line
            label="Rank"
            value={member.rankName ? `${member.acting ? "Acting " : ""}${member.rankName}` : "None"}
            note={member.gradeCode ?? undefined}
          />
          <Line label="Post" value={member.postTitle ?? "None"} note={member.unitName ?? undefined} />
          {member.roles.length > 0 ? (
            <Line label="Roles on this site" value={member.roles.map((role) => roleNames[role]).join(", ")} />
          ) : null}
          <Line label="Discord" value={member.discordName ?? "Unknown"} />
          {member.status === "applicant" || member.status === "discharged" ? null : (
            <div>
              <dt>The fleet</dt>
              <dd>
                <Link href="/order-of-battle">See the order of battle</Link>
                <span className="aside">
                  <Link href="/operations">Operations</Link>
                </span>
              </dd>
            </div>
          )}
        </dl>
      </section>

      <section className="wrap band" aria-labelledby="names">
        <h2 id="names">Your names</h2>
        <NamesForm
          characterName={member.characterName}
          rsiHandle={member.rsiHandle}
          nameIsFixed={member.status !== "applicant" && member.characterName !== null}
        />
      </section>

      {member.status === "applicant" ? (
        <section className="wrap band" aria-labelledby="applying">
          <h2 id="applying">Applying</h2>
          <div className="prose">
            {recruitmentOpen ? (
              <>
                <p>Recruitment is open. Set your names above first, then apply.</p>
                <p className="actions">
                  <Link className="button" href="/apply">
                    Apply, or see your application
                  </Link>
                </p>
              </>
            ) : (
              <p>
                Recruitment opens on {site.recruitmentOpens}. Until then there is nothing to apply for. Set your names
                above so you are ready.
              </p>
            )}
          </div>
        </section>
      ) : null}

      {isStaff(member) ? (
        <section className="wrap band" aria-labelledby="staff">
          <h2 id="staff">Staff work</h2>
          <div>
            <p>Read applications, keep interview notes, and accept or decline. The admin pages hold the fleet&apos;s figures.</p>
            <p className="actions">
              <Link className="button button-quiet" href="/staff/applications">
                Applications
              </Link>
              <Link className="button button-quiet" href="/admin">
                Fleet admin
              </Link>
            </p>
          </div>
        </section>
      ) : null}

      <section className="wrap band band-last" aria-labelledby="leaving">
        <h2 id="leaving">Signing out</h2>
        <div>
          <p>Sign out when you are on a computer that is not yours.</p>
          <SignOut />
        </div>
      </section>
    </>
  );
}

function heading(member: Member): string {
  if (!member.characterName) return "Your record";
  if (!member.rankName) return member.characterName;
  return `${member.acting ? "Acting " : ""}${member.rankName} ${member.characterName}`;
}

function Line({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        {value}
        {note ? <span className="aside">{note}</span> : null}
      </dd>
    </div>
  );
}

function SignOut() {
  return (
    <form action={signOut} className="actions">
      <button className="button button-quiet" type="submit">
        Sign out
      </button>
    </form>
  );
}
