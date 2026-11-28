/**
 * Typefaces a shop renter can pick for their 3D shop sign (tenant_accounts.sign_font). Pure registry: shared by the
 * server (validation), the seller's picker (previews) and the 3D sign (canvas lettering).
 *
 * The font files themselves are self-hosted by next/font (src/app/sign-fonts.ts), each exposed as a CSS variable on
 * <html>; the browser only downloads a font when a page actually uses it (the picker, or a sign that needs it).
 * Adding a font = one entry here + one next/font declaration there (the DB only checks the id's format).
 */

export interface SignFont {
  id: string;
  label: string;
  /** One or two words that tell the shop owner what the font feels like. */
  mood: string;
  /** CSS variable holding the font-family (set by next/font on <html>). */
  cssVar: string;
  /** Weight to draw with (must be one of the weights loaded for it). */
  weight: number;
  /** Shown in capitals on the sign (scripts and handwriting read better as typed). */
  upper: boolean;
}

export const SIGN_FONTS: readonly SignFont[] = [
  { id: "bricolage", label: "Bricolage", mood: "Bold & modern (house style)", cssVar: "--font-bricolage", weight: 800, upper: true },
  { id: "bebas-neue", label: "Bebas Neue", mood: "Tall & commanding", cssVar: "--font-sign-bebas", weight: 400, upper: true },
  { id: "anton", label: "Anton", mood: "Ultra-bold impact", cssVar: "--font-sign-anton", weight: 400, upper: true },
  { id: "syne", label: "Syne", mood: "Avant-garde & strong", cssVar: "--font-sign-syne", weight: 800, upper: true },
  { id: "alfa-slab", label: "Alfa Slab", mood: "Heavy poster slab", cssVar: "--font-sign-alfaslab", weight: 400, upper: true },
  { id: "bungee", label: "Bungee", mood: "Street signage", cssVar: "--font-sign-bungee", weight: 400, upper: true },
  { id: "russo-one", label: "Russo One", mood: "Sporty & sharp", cssVar: "--font-sign-russo", weight: 400, upper: true },
  { id: "black-ops-one", label: "Black Ops One", mood: "Stencil / army", cssVar: "--font-sign-blackops", weight: 400, upper: true },
  { id: "rubik-mono", label: "Rubik Mono", mood: "Wide & loud", cssVar: "--font-sign-rubikmono", weight: 400, upper: true },
  { id: "orbitron", label: "Orbitron", mood: "Tech & gaming", cssVar: "--font-sign-orbitron", weight: 900, upper: true },
  { id: "audiowide", label: "Audiowide", mood: "Sleek cyber", cssVar: "--font-sign-audiowide", weight: 400, upper: true },
  { id: "monoton", label: "Monoton", mood: "Neon club", cssVar: "--font-sign-monoton", weight: 400, upper: true },
  { id: "bodoni-moda", label: "Bodoni Moda", mood: "High-fashion sexy", cssVar: "--font-sign-bodoni", weight: 900, upper: false },
  { id: "cinzel", label: "Cinzel", mood: "Royal & chiseled", cssVar: "--font-sign-cinzel", weight: 900, upper: true },
  { id: "yeseva-one", label: "Yeseva One", mood: "Sensual & curvaceous", cssVar: "--font-sign-yeseva", weight: 400, upper: false },
  { id: "abril-fatface", label: "Abril Fatface", mood: "Fashion & magazine", cssVar: "--font-sign-abril", weight: 400, upper: false },
  { id: "playfair", label: "Playfair Display", mood: "Elegant luxury", cssVar: "--font-sign-playfair", weight: 900, upper: false },
  { id: "shrikhand", label: "Shrikhand", mood: "Groovy & lush", cssVar: "--font-sign-shrikhand", weight: 400, upper: false },
  { id: "righteous", label: "Righteous", mood: "Retro 70s", cssVar: "--font-sign-righteous", weight: 400, upper: true },
  { id: "luckiest-guy", label: "Luckiest Guy", mood: "Cartoon fun", cssVar: "--font-sign-luckiest", weight: 400, upper: true },
  { id: "bangers", label: "Bangers", mood: "Comic book", cssVar: "--font-sign-bangers", weight: 400, upper: true },
  { id: "lilita-one", label: "Lilita One", mood: "Chunky & friendly", cssVar: "--font-sign-lilita", weight: 400, upper: true },
  { id: "titan-one", label: "Titan One", mood: "Bubbly", cssVar: "--font-sign-titan", weight: 400, upper: true },
  { id: "fredoka", label: "Fredoka", mood: "Soft & rounded", cssVar: "--font-sign-fredoka", weight: 700, upper: false },
  { id: "press-start", label: "Press Start", mood: "Pixel arcade", cssVar: "--font-sign-pressstart", weight: 400, upper: true },
  { id: "pacifico", label: "Pacifico", mood: "Beachy script", cssVar: "--font-sign-pacifico", weight: 400, upper: false },
  { id: "lobster", label: "Lobster", mood: "Vintage script", cssVar: "--font-sign-lobster", weight: 400, upper: false },
  { id: "sacramento", label: "Sacramento", mood: "Delicate signature", cssVar: "--font-sign-sacramento", weight: 400, upper: false },
  { id: "permanent-marker", label: "Permanent Marker", mood: "Hand-drawn marker", cssVar: "--font-sign-marker", weight: 400, upper: false },
];

export const DEFAULT_SIGN_FONT = "bricolage";

export function isSignFont(id: unknown): id is string {
  return typeof id === "string" && SIGN_FONTS.some((f) => f.id === id);
}

/** The font for an id (unknown / removed ids fall back to the house style). */
export function signFont(id: string | null | undefined): SignFont {
  return SIGN_FONTS.find((f) => f.id === id) ?? SIGN_FONTS[0]!;
}

/** The sign's text in the font's preferred case. */
export function signText(text: string, font: SignFont): string {
  return font.upper ? text.toUpperCase() : text;
}
