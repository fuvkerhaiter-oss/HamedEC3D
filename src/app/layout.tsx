import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, JetBrains_Mono, Plus_Jakarta_Sans } from "next/font/google";
import { Providers } from "@/components/Providers";
import "./globals.css";

// Display: bold, characterful grotesk for headlines. Body: clean professional sans. Mono: labels, prices, indices.
const display = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-bricolage", display: "swap" });
const sans = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-jakarta", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", display: "swap", weight: ["400", "500"] });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"),
  title: { default: "Mega Market · Happy Family, Happy Animals", template: "%s · Mega Market" },
  description: "Mega Market — Happy Family, Happy Animals. Walk a beautiful 3D supermarket in your browser and shop real products, delivered across Europe and the USA.",
  applicationName: "Mega Market",
  openGraph: {
    type: "website",
    siteName: "Mega Market",
    title: "Mega Market · Happy Family, Happy Animals",
    description: "Walk a 3D supermarket in your browser, shop with friends and get it delivered across Europe and the USA.",
  },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = { themeColor: "#111513" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <body className="min-h-dvh font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
