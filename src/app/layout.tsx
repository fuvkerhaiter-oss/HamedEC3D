import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, JetBrains_Mono, Plus_Jakarta_Sans } from "next/font/google";
import { Providers } from "@/components/Providers";
import { SITE_NAME, siteUrl } from "@/lib/seo/site";
import "./globals.css";

// Display: bold, characterful grotesk for headlines. Body: clean professional sans. Mono: labels, prices, indices.
const display = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-bricolage", display: "swap" });
const sans = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-jakarta", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", display: "swap", weight: ["400", "500"] });

// Search-engine ownership checks (Search Console / Bing Webmaster Tools): set the tokens in the environment.
const verification: Metadata["verification"] = {
  ...(process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION ? { google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION } : {}),
  ...(process.env.NEXT_PUBLIC_BING_SITE_VERIFICATION ? { other: { "msvalidate.01": process.env.NEXT_PUBLIC_BING_SITE_VERIFICATION } } : {}),
};

// Defaults only. Every indexable page sets its own title, description and canonical (a canonical here would be
// inherited by pages that forget theirs and point them all at the homepage). Share image: app/opengraph-image.jpg.
export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: { default: `${SITE_NAME} · Online Store & Interactive 3D Supermarket`, template: `%s · ${SITE_NAME}` },
  description: "Shop real products online at WEGO SHIIIP, by list or by walking an interactive 3D supermarket in your browser. Prices in EUR and USD, delivered across the EU and the USA.",
  applicationName: SITE_NAME,
  formatDetection: { telephone: false, address: false, email: false },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    locale: "en",
    title: `${SITE_NAME} · Happy Family, Happy Animals`,
    description: "Shop real products online, or walk an interactive 3D supermarket in your browser. Delivered across the EU and the USA.",
  },
  twitter: { card: "summary_large_image" },
  ...(Object.keys(verification).length ? { verification } : {}),
};

export const viewport: Viewport = { themeColor: "#0d0f0e" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      {/* Browser extensions inject attributes on <body> (e.g. location="…") before hydration. */}
      <body className="min-h-dvh font-sans antialiased" suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
