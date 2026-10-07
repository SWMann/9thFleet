import type { Metadata } from "next";
import { Suspense } from "react";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Members and applicants of the UEE 9th Fleet sign in with Discord.",
  robots: { index: false, follow: false },
};

const problems: Record<string, string> = {
  setup: "Sign-in is not set up on this site yet.",
  discord: "Discord could not be reached. Try again in a minute.",
  cancelled: "You left Discord before finishing, so you are not signed in.",
  service: "Discord let you through, but the sign-in service could not finish. This is a fault on our side, not something you did. Tell the fleet's staff.",
  callback: "Discord sent you back, but the sign-in could not be completed. Try again.",
};

export default function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  return (
    <>
      <div className="wrap page-head">
        <h1>Sign in</h1>
        <p className="lead">
          The fleet uses your Discord account to know who you are. There is no separate password to remember.
        </p>
        <Suspense fallback={null}>
          <Problem searchParams={searchParams} />
        </Suspense>
        {/* A plain form post, not a Server Action: see app/auth/discord/route.ts. */}
        <form method="post" action="/auth/discord">
          <button className="button" type="submit">
            Sign in with Discord
          </button>
        </form>
      </div>

      <section className="wrap band band-last" aria-labelledby="what-happens">
        <h2 id="what-happens">What happens</h2>
        <div className="prose">
          <ul>
            <li>
              Discord asks whether {site.name} may see your Discord name, picture and email address. It cannot read
              your messages or see which servers you are in.
            </li>
            <li>The first time, the fleet opens a record for you as an applicant. You are not a member yet.</li>
            <li>Recruitment opens on {site.recruitmentOpens}. Until then there is nothing to apply for.</li>
          </ul>
        </div>
      </section>
    </>
  );
}

async function Problem({ searchParams }: { searchParams: PageProps<"/sign-in">["searchParams"] }) {
  const { problem } = await searchParams;
  const message = typeof problem === "string" ? problems[problem] : undefined;
  if (!message) return null;
  return (
    <p className="notice" role="alert">
      {message}
    </p>
  );
}
