import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@fontsource-variable/archivo/wdth.css";
import "./globals.css";
import { Keel } from "@/components/Keel";
import { Masthead } from "@/components/Masthead";
import { indexable, site } from "@/lib/site";

export const metadata: Metadata = {
  title: { default: site.name, template: `%s | ${site.name}` },
  description: site.description,
  robots: indexable ? undefined : { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-GB">
      <body>
        <a className="skip" href="#content">
          Skip to the content
        </a>
        <Masthead />
        <main id="content">{children}</main>
        <Keel />
      </body>
    </html>
  );
}
