import type { PictureName } from "@/lib/pictures";

/** Every page a visitor can go to, grouped as the menu shows them. */
export const menu: { title: string; picture: PictureName; links: { href: string; label: string }[] }[] = [
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
    links: [
      { href: "/sign-in", label: "Sign in" },
      { href: "/profile", label: "Your record" },
      { href: "/order-of-battle", label: "Order of battle" },
    ],
  },
];
