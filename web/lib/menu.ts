import type { PictureName } from "@/lib/pictures";

export type MenuLink = { href: string; label: string };

export type MenuGroup = {
  title: string;
  picture: PictureName;
  /** What a visitor sees. */
  links: MenuLink[];
  /** What a signed-in member sees instead, where that differs. */
  signedIn?: MenuLink[];
  /** A line under a visitor's links, saying what signing in adds. */
  note?: string;
};

/** Every page, grouped as the menu shows them. Add a page here when it ships. */
export const menu: MenuGroup[] = [
  {
    title: "The fleet",
    picture: "menuFleet",
    links: [
      { href: "/", label: "Front page" },
      { href: "/standards", label: "Standards" },
      { href: "/ranks", label: "Ranks and structure" },
    ],
  },
  {
    title: "Joining",
    picture: "menuJoining",
    links: [
      { href: "/joining", label: "How joining works" },
      { href: "/apply", label: "Apply to join" },
    ],
  },
  {
    title: "Members",
    picture: "menuMembers",
    links: [{ href: "/sign-in", label: "Sign in" }],
    signedIn: [
      { href: "/profile", label: "Your record" },
      { href: "/order-of-battle", label: "Order of battle" },
    ],
    note: "Your record and the order of battle appear here once you have signed in.",
  },
];
