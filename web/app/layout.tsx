import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import "@fontsource/titillium-web/latin-300.css";
import "@fontsource/titillium-web/latin-400.css";
import "@fontsource/titillium-web/latin-600.css";
import "@fontsource/titillium-web/latin-700.css";
import "./globals.css";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { VisitBeacon } from "@/components/VisitBeacon";
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
        <SiteHeader />
        <main id="content">{children}</main>
        <SiteFooter />
        <Suspense fallback={null}>
          <VisitBeacon />
        </Suspense>
      </body>
    </html>
  );
}
