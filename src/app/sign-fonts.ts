/**
 * Self-hosted typefaces for the rental shop signs (choices: lib/rentals/sign-fonts.ts). next/font downloads them at
 * build time and serves them from this site (no request to Google from the visitor). Each sets a CSS variable on
 * <html>; a font file is only fetched by the browser when something uses it. `preload: false` keeps them off the
 * critical path of every page.
 */
import {
  Abril_Fatface,
  Alfa_Slab_One,
  Anton,
  Audiowide,
  Bangers,
  Bebas_Neue,
  Black_Ops_One,
  Bodoni_Moda,
  Bungee,
  Cinzel,
  Fredoka,
  Lilita_One,
  Lobster,
  Luckiest_Guy,
  Monoton,
  Orbitron,
  Pacifico,
  Permanent_Marker,
  Playfair_Display,
  Press_Start_2P,
  Righteous,
  Rubik_Mono_One,
  Russo_One,
  Sacramento,
  Shrikhand,
  Syne,
  Titan_One,
  Yeseva_One,
} from "next/font/google";

const luckiest = Luckiest_Guy({ weight: "400", subsets: ["latin"], variable: "--font-sign-luckiest", display: "swap", preload: false });
const bangers = Bangers({ weight: "400", subsets: ["latin"], variable: "--font-sign-bangers", display: "swap", preload: false });
const lilita = Lilita_One({ weight: "400", subsets: ["latin"], variable: "--font-sign-lilita", display: "swap", preload: false });
const titan = Titan_One({ weight: "400", subsets: ["latin"], variable: "--font-sign-titan", display: "swap", preload: false });
const fredoka = Fredoka({ weight: "700", subsets: ["latin"], variable: "--font-sign-fredoka", display: "swap", preload: false });
const bungee = Bungee({ weight: "400", subsets: ["latin"], variable: "--font-sign-bungee", display: "swap", preload: false });
const righteous = Righteous({ weight: "400", subsets: ["latin"], variable: "--font-sign-righteous", display: "swap", preload: false });
const russo = Russo_One({ weight: "400", subsets: ["latin"], variable: "--font-sign-russo", display: "swap", preload: false });
const blackops = Black_Ops_One({ weight: "400", subsets: ["latin"], variable: "--font-sign-blackops", display: "swap", preload: false });
const orbitron = Orbitron({ weight: "900", subsets: ["latin"], variable: "--font-sign-orbitron", display: "swap", preload: false });
const pressStart = Press_Start_2P({ weight: "400", subsets: ["latin"], variable: "--font-sign-pressstart", display: "swap", preload: false });
const rubikMono = Rubik_Mono_One({ weight: "400", subsets: ["latin"], variable: "--font-sign-rubikmono", display: "swap", preload: false });
const abril = Abril_Fatface({ weight: "400", subsets: ["latin"], variable: "--font-sign-abril", display: "swap", preload: false });
const playfair = Playfair_Display({ weight: "900", subsets: ["latin"], variable: "--font-sign-playfair", display: "swap", preload: false });
const pacifico = Pacifico({ weight: "400", subsets: ["latin"], variable: "--font-sign-pacifico", display: "swap", preload: false });
const lobster = Lobster({ weight: "400", subsets: ["latin"], variable: "--font-sign-lobster", display: "swap", preload: false });
const marker = Permanent_Marker({ weight: "400", subsets: ["latin"], variable: "--font-sign-marker", display: "swap", preload: false });
const bebas = Bebas_Neue({ weight: "400", subsets: ["latin"], variable: "--font-sign-bebas", display: "swap", preload: false });
const anton = Anton({ weight: "400", subsets: ["latin"], variable: "--font-sign-anton", display: "swap", preload: false });
const syne = Syne({ weight: "800", subsets: ["latin"], variable: "--font-sign-syne", display: "swap", preload: false });
const alfaSlab = Alfa_Slab_One({ weight: "400", subsets: ["latin"], variable: "--font-sign-alfaslab", display: "swap", preload: false });
const cinzel = Cinzel({ weight: "900", subsets: ["latin"], variable: "--font-sign-cinzel", display: "swap", preload: false });
const bodoni = Bodoni_Moda({ weight: "900", subsets: ["latin"], variable: "--font-sign-bodoni", display: "swap", preload: false });
const yeseva = Yeseva_One({ weight: "400", subsets: ["latin"], variable: "--font-sign-yeseva", display: "swap", preload: false });
const monoton = Monoton({ weight: "400", subsets: ["latin"], variable: "--font-sign-monoton", display: "swap", preload: false });
const audiowide = Audiowide({ weight: "400", subsets: ["latin"], variable: "--font-sign-audiowide", display: "swap", preload: false });
const shrikhand = Shrikhand({ weight: "400", subsets: ["latin"], variable: "--font-sign-shrikhand", display: "swap", preload: false });
const sacramento = Sacramento({ weight: "400", subsets: ["latin"], variable: "--font-sign-sacramento", display: "swap", preload: false });

/** Class names that define every sign font's CSS variable (put on <html>). */
export const signFontVariables = [
  luckiest,
  bangers,
  lilita,
  titan,
  fredoka,
  bungee,
  righteous,
  russo,
  blackops,
  orbitron,
  pressStart,
  rubikMono,
  abril,
  playfair,
  pacifico,
  lobster,
  marker,
  bebas,
  anton,
  syne,
  alfaSlab,
  cinzel,
  bodoni,
  yeseva,
  monoton,
  audiowide,
  shrikhand,
  sacramento,
]
  .map((f) => f.variable)
  .join(" ");
