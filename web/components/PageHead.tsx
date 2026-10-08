import type { ReactNode } from "react";
import type { PictureName } from "@/lib/pictures";
import { Picture } from "./Picture";

/**
 * The top of an inner page: a picture across the page with the title on it.
 * Mark the word that matters in the title with <strong>.
 */
export function PageHead({
  picture,
  title,
  lead,
  before,
  slim = false,
  children,
}: {
  picture: PictureName;
  title: ReactNode;
  lead?: ReactNode;
  /** Something above the title, such as a link back. */
  before?: ReactNode;
  /** A shorter banner, for pages that are mostly a form or a list. */
  slim?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className={slim ? "banner banner-slim" : "banner"}>
      <Picture name={picture} eager />
      <div className="banner-shade" aria-hidden="true" />
      <div className="wrap page-head">
        {before}
        <h1>{title}</h1>
        {lead ? <p className="lead">{lead}</p> : null}
        {children}
      </div>
    </div>
  );
}
