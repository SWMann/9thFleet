import type { PictureName } from "@/lib/pictures";

export type MenuLink = { href: string; label: string };

export type MenuGroup = {
  title: string;
  picture: PictureName;
  /** What a visitor sees. */
  links: MenuLink[];
  /** What a signed-in member sees instead, where that differs. */
  signedIn?: MenuLink[];
  /** Added to a signed-in member's links when they help run the fleet. */
  admin?: MenuLink[];
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
    title: "Fleet manual",
    picture: "menuManual",
    links: [
      { href: "/manual", label: "By volume" },
      { href: "/roles", label: "By role" },
      { href: "/manual/organisation", label: "Volume 1: Organisation" },
      { href: "/manual/command", label: "Volume 2: Command" },
    ],
  },
  {
    title: "Members",
    picture: "menuMembers",
    links: [{ href: "/sign-in", label: "Sign in" }],
    signedIn: [
      { href: "/profile", label: "Your record" },
      { href: "/order-of-battle", label: "Order of battle" },
      { href: "/operations", label: "Operations" },
    ],
    admin: [{ href: "/admin", label: "Fleet admin" }],
    note: "Your record, the order of battle and operations appear here once you have signed in.",
  },
];
