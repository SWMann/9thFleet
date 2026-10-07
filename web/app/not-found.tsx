import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Nothing heard" };

export default function NotFound() {
  return (
    <div className="wrap page-head">
      <h1>Nothing heard.</h1>
      <p className="lead">That page does not exist. The address may be wrong, or the page may have moved.</p>
      <p>
        <Link className="button" href="/">
          Go to the front page
        </Link>
      </p>
    </div>
  );
}
