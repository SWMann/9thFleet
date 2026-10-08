import type { Metadata } from "next";
import Link from "next/link";
import { PageHead } from "@/components/PageHead";

export const metadata: Metadata = { title: "Nothing heard" };

export default function NotFound() {
  return (
    <PageHead
      picture="lost"
      title={<strong>Nothing heard.</strong>}
      lead="That page does not exist. The address may be wrong, or the page may have moved."
    >
      <p className="actions">
        <Link className="button" href="/">
          Go to the front page
        </Link>
      </p>
    </PageHead>
  );
}
