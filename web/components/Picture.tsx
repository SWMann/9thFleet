import Image from "next/image";
import Link from "next/link";
import { pictures, type PictureName } from "@/lib/pictures";

/**
 * A picture that fills its parent, which must be positioned. It is decoration,
 * so it has no description. Its author is named in a corner.
 *
 * A wallpaper from the fan kit is the exception. It is shown whole and as it
 * is, with nothing over it: its own watermark says whose it is, and the style
 * sheet gives its frame the picture's shape so nothing is cropped.
 */
export function Picture({
  name,
  sizes = "100vw",
  eager = false,
  className,
  credit = "top-right",
}: {
  name: PictureName;
  /** How wide the picture is shown, so the browser fetches a file of the right size. */
  sizes?: string;
  /** Load at once, for the picture at the top of a page. */
  eager?: boolean;
  className?: string;
  /** The corner the credit sits in, or false when a Credit is placed by hand nearby. */
  credit?: "top-right" | "top-left" | "bottom-right" | "bottom-left" | false;
}) {
  const picture = pictures[name];
  const asIs = picture.shot.source === "fankit";
  const classes = ["picture", asIs ? "picture-asis" : "", className ?? ""].filter(Boolean).join(" ");
  return (
    <>
      <Image
        className={classes}
        src={picture.shot.image}
        alt=""
        fill
        sizes={sizes}
        placeholder={asIs ? "empty" : "blur"}
        loading={eager ? "eager" : "lazy"}
        fetchPriority={eager ? "high" : undefined}
        style={{ objectPosition: picture.focus }}
      />
      {credit && !asIs ? <Credit name={name} corner={credit} /> : null}
    </>
  );
}

/** Names the picture's author, as its licence asks. The credits page has the rest. */
export function Credit({ name, corner }: { name: PictureName; corner: string }) {
  const { shot } = pictures[name];
  return (
    <Link className={`credit credit-${corner}`} href={`/credits#shot-${shot.id}`} prefetch={false}>
      Picture: {shot.author.name}
    </Link>
  );
}
