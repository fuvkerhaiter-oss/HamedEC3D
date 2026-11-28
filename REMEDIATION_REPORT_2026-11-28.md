# WEGO SHIIIP — Remediation report (2026-11-28)

Follows the independent audit `AUDIT_2026-11-27.md`. Everything below was done in the codebase on `main` (nothing
committed, nothing deployed, no production data touched).

**Evidence labels:** **VERIFIED** = covered by a passing automated test or measured on a local production build ·
**IMPLEMENTED** = code in place, typechecks, not exercised end-to-end · **EXTERNAL** = needs configuration or credentials ·
**FOUNDER** = needs your decision, data or paperwork · **LEGAL** = needs a lawyer.

---

## 1. Executive summary

The code can no longer take an order under a placeholder identity, sell sample products, or show unverified
reference prices. It also no longer shows trademarked props, and phones no longer download the 3D store just to
see the homepage. Security now covers what the audit found missing: a rate limiter shared across server instances,
admin two-factor sign-in, an exit notice before tenant payment links, voice/multiplayer off by default, shortened
visitor IPs, and draft CMS text hidden from the public key. Operations gained CI, error alerts, a health endpoint
and a privacy-friendly conversion funnel.

**Production still cannot sell**, and code cannot change that. Production has no shipping zones, the legal pages
still contain placeholders, and there are no real products, prices from carriers, or company identity. The code now
blocks sales and states exactly what is missing. The data has to come from you.

## 2. Before → after (audit findings)

| # | Audit finding | Status now | Evidence |
|---|---|---|---|
| 1 | Checkout refuses every destination | **Root cause = no zones in prod (data), not a code bug.** Checkout now lists only countries the server can quote. If there are none, it says delivery isn't set up. Admin → Shipping shows "can ship to X of 28" and why the rest can't (no zone, or methods in the wrong currency). | VERIFIED (unit `shipping-coverage`); prod zones = FOUNDER |
| 2 | Legal placeholders live | New launch gate blocks production checkout. It detects bracket/mustache placeholders, TODO/TBD, XXX, lorem, example.com, the TEMPLATE banner, "CHOOSE ONE", pages that are too short, a missing or fake-looking seller name/address/VAT, and Terms that don't name the seller. If the check itself fails, checkout stays closed. The shipped templates can never pass. **The pages themselves are still public with placeholders until you fill or unpublish them.** | VERIFIED (unit `legal-readiness`, 4 tests); content = FOUNDER/LEGAL |
| 3 | Sample products live | Hidden from storefront, 3D store, sitemap and search, and **refused by server pricing** in production unless `SHOW_SAMPLE_PRODUCTS=true`. No records deleted. | VERIFIED (unit); prod effect after deploy |
| 4 | Product titles/categories | Empty categories are hidden in the filter panel. **Titles, descriptions and category assignments are data**: I did not rewrite them, because I have no verified product information. | FOUNDER |
| 5 | GTA 6 / PS5 assets | Removed from the store and replaced with original unbranded gift boxes. GLBs, sources and cover art moved to gitignored `licensing-hold/` (kept on disk; **still in git history**). | VERIFIED (build, grep) |
| 5b | Unlicensed music | The "All I Want for Christmas Is You" instrumental was withdrawn from `public/`. The store track plays instead. A licence register was added to ASSET_INVENTORY.md: the core supermarket, trolley, Christmas models and store music are still **UNKNOWN licence**. | FOUNDER |
| 6 | Misleading rental discounts | No struck-through never-charged prices and no "−31%" badges. Plans now show "Intro price" plus the standard price for bookings after 31 Mar 2027. Charges are unchanged. | IMPLEMENTED; wording = LEGAL |
| 7 | "$20" in EUR mode | Hero CTA follows the selected market currency. The shop size claim was corrected (9×14 → 18×24 m from the actual constant) and the "EU + US shoppers" claim removed. | IMPLEMENTED |
| 8 | Positioning | Homepage headline: "Everyday finds for families and their pets", built on your own tagline. Hard-coded "Pantry/Drinks/Snacks" ribbon and "28 countries served" removed. Category names in the DB still need curating. | IMPLEMENTED; FOUNDER |
| 9 | Mobile splash | Phones now see a visible headline, "Shop products" (primary) and "Enter the 3D store", then a trust row, then "In stock now". No horizontal overflow at 375 px. | VERIFIED (screenshot, prod build) |
| 10 | Heavy 3D payload | Homepage background preload is desktop-only. Christmas models load after the core store is ready. | VERIFIED (measured, §8) |
| 11 | In-memory rate limit | Postgres-backed shared limiter (hashed keys) on OTP, admin login, checkout, quote, coupons, contact, lookup, withdrawal, rentals and account delete. The memory layer stays in front of it. | VERIFIED (integration) |
| 12 | No admin MFA | TOTP two-factor with AES-GCM-encrypted secrets, replay protection, 8 hashed single-use recovery codes, a CLI reset, an audit log entry, and optional enforcement that redirects to enrolment (no lockout). Admin login also gets a 10/15 min/IP throttle. | VERIFIED (unit RFC 6238 vectors + integration) |
| 13 | No CI / monitoring | GitHub Actions CI. Unhandled-error instrumentation and Slack/Discord alerts. `/api/health`. | CI = IMPLEMENTED (not yet run on GitHub); alerts = EXTERNAL |
| 14 | No analytics | 11-step funnel, tagged by discovery path (3d/catalog) and device, with purchase revenue. Cookieless Plausible via a same-origin rewrite. Query strings, tokens and emails are stripped. | VERIFIED (unit for privacy filters); EXTERNAL (account) |
| 15 | Voice/multiplayer risk | **Off in production by default.** If enabled: a voice notice and consent (strangers, IP exposure, 16+), mute everyone, leave room, report link. | IMPLEMENTED |
| 16 | Tenant links | Already https-only in code. Now also re-validated at redirect time, plus a `/leaving/[id]` exit notice naming seller and host, with a warning for unrecognised hosts. | VERIFIED (unit link rules); page IMPLEMENTED |
| 17 | 25 h stock hold | Stripe session 60 min, order released at 90 min. | VERIFIED (integration checkout) |
| 18 | Visitor write load / raw IP | Heartbeat 60 → 120 s (half the pings). IPs stored shortened (203.0.113.0). Privacy template updated. | VERIFIED (unit) |
| 19 | DB exposure (S8) | `cms_pages.draft_body` is no longer readable by anon/authenticated (column grants). | VERIFIED (integration) |
| — | EU region, CSP nonces, git-history purge | Not done. | FOUNDER decisions |

## 3. Scorecard (0–10)

Same 33 categories. Scores are mine and judged strictly: code-only improvements that aren't running in production
are capped.

| # | Category | Old | New | Evidence / what's missing |
|---|---|---|---|---|
| 1 | Product concept | 4 | 5 | 3D is now optional on top of conventional shopping; value still unproven |
| 2 | Problem-solving value | 3 | 3 | No change possible in code |
| 3 | Feature completeness | 6 | 7 | MFA, funnel, alerts, coverage, exit notice; prod config missing |
| 4 | Functional reliability | 4 | 5 | Tests green, gates fail closed; prod checkout still blocked by data |
| 5 | Frontend quality | 6 | 7 | −87 % mobile home payload, progressive 3D |
| 6 | Backend quality | 7 | 8 | Shared limiter, legal gate, MFA service, all tested |
| 7 | Architecture | 6 | 7 | Shared state for limits, instrumentation, health; still US region |
| 8 | Code quality | 7 | 7 | Consistent with existing patterns |
| 9 | UI design | 6 | 6 | Hero/trust row only; no full design-system pass |
| 10 | UX | 4 | 6 | Product-first mobile, honest country list, exit notice |
| 11 | Branding | 5 | 5 | Copy aligned on home; categories/logo positioning unchanged |
| 12 | Accessibility | 4 | 5 | Visible h1, labelled controls, 48 px CTAs; no formal WCAG audit |
| 13 | Mobile responsiveness | 6 | 7 | Verified 375 px; 390/414/430 not individually checked |
| 14 | Performance | 5 | 6 | Home measured; 3D store itself still ~5.5 MB once entered |
| 15 | Security | 6 | 8 | 7 findings fixed and tested; CSP `unsafe-inline` remains |
| 16 | Scalability | 5 | 6 | Fewer beacon writes; limiter adds writes only on sensitive routes |
| 17 | Database design | 7 | 7 | Additive migration, RLS kept |
| 18 | API design | 6 | 6 | Health endpoint; otherwise unchanged |
| 19 | Testing | 7 | 7 | +22 tests, CI defined but not yet run on GitHub |
| 20 | Maintainability | 5 | 6 | CI, licence register, documented env |
| 21 | Reliability | 4 | 5 | Alerts/health exist but are not configured yet |
| 22 | User onboarding | 4 | 5 | No 3D gate before products |
| 23 | Customer experience | 3 | 4 | Still no order possible in prod |
| 24 | Pricing strategy | 3 | 4 | Honest rental presentation; product pricing unvalidated |
| 25 | Monetisation potential | 3 | 3 | Unchanged |
| 26 | Market opportunity | 4 | 4 | Unchanged |
| 27 | Competitive positioning | 3 | 4 | Clearer hybrid positioning |
| 28 | Differentiation | 5 | 5 | Unchanged; now measurable via funnel |
| 29 | Marketing readiness | 3 | 4 | Funnel ready once Plausible is set |
| 30 | Sales readiness | 1 | 2 | Blocked by shipping + legal data |
| 31 | Production readiness | 3 | 5 | Blockers guarded and listed; config outstanding |
| 32 | Trustworthiness | 3 | 4 | No samples/trademarks/fake discounts; legal pages still show placeholders |
| 33 | Overall product quality | 4 | 5 | — |

## 4. Overall

Weights as in the audit. Product/market 35 % (1,2,24–28). Readiness 35 % (3,4,15,22,23,31,32). Engineering 20 %
(5–8,14,16–20). Design/brand/GTM 10 % (9–13,29,30).

| | Before | After |
|---|---|---|
| Raw average (33) | 4.6 | **5.4** |
| Weighted (recomputed from the table with the stated weights) | 4.3 (audit printed 4.1) | **5.1** |
| **A. Software & execution score** (categories 3–23, 31, 32) | ~5.0 | **6.1** |
| **B. Business validation score** (customers, revenue, demand, retention) | ~1 | **~1**: no customers, orders or revenue. Engineering cannot change this. |

The 7/10 software target was **not** reached. The rest is gated by production configuration and content
(shipping, legal identity, real products), a real Stripe test, real-device testing and an accessibility audit.

## 5. Critical fixes completed

Legal launch gate. Shipping coverage and country filtering. Sample products non-sellable in production. Trademarked
props and the unlicensed recording withdrawn. Honest rental pricing and the currency CTA fix. 90-min stock hold.

## 6. Security changes (verification)

- Shared rate limiter: integration test simulates two instances, the 6th hit is blocked, keys are hashed and purged daily.
- Admin TOTP: RFC 6238 vectors. Password alone → `mfa_required`. Replay and wrong codes refused and counted as failures. Recovery codes are single-use. A refused password does not burn a code. Disabling needs password + code. Enrolment is refused without `ADMIN_MFA_KEY`.
- Admin login IP throttle (shared). MFA policy enforced in `requirePage`, `requireApi` and `adminAction`, with the set-up page exempt (no lockout).
- Tenant links re-validated at redirect, plus the exit notice. Multiplayer is off by default.
- CMS drafts are hidden from browser roles (integration test: `permission denied`). Visitor IPs are shortened.
- `check:env` now covers `ADMIN_MFA_KEY`, `ADMIN_REQUIRE_MFA`, `OPS_ALERT_WEBHOOK_URL`, `SHOW_SAMPLE_PRODUCTS`, multiplayer/TURN, full-IP logging and analytics.

## 7. UX and design

Homepage hero rebuilt product-first, with a trust row (only facts the code guarantees: Stripe payment, guest checkout,
EU withdrawal, VAT-inclusive EU prices) and "In stock now" directly under the hero. The checkout country list only
offers real destinations. Exit notice for tenant products. Voice consent dialog and room controls. Admin Security page.
**Not done:** a full design-system pass, PDP/cart/checkout redesign, and dialog/focus audit.

## 8. Performance (measured, local production build, Edge, 375×812 touch emulation, homepage, 12 s idle, encoded bytes)

| | Before | After |
|---|---|---|
| Total downloaded | **6,765 KB** | **885 KB** (−87 %) |
| 3D models (GLB) | 5,473 KB (10 files incl. 3.3 MB Christmas) | 0 KB until the shopper taps "Enter the 3D store" |
| JavaScript | 679 KB | 344 KB |
| Images | 438 KB | 367 KB |

After a tap, the core models (supermarket 1.18 MB + trolley 0.68 MB + chain 0.28 MB) start first. The Christmas set
starts ~1.2 s later, after the core store is ready. LCP/INP were not measured (no throttled lab run). Desktop
behaviour is unchanged (still preloads).

## 9. Tests

- Typecheck: clean. Lint: clean. **Unit: 267/267** (+22 new: legal readiness, shipping coverage, MFA/TOTP, launch hardening; 1 updated for the music change).
- **Integration: 82/82** (all files, run sequentially). Running files concurrently on Windows stalled (several embedded Postgres instances at once), so `test:integration` now uses `--test-concurrency=1`.
- Build: OK (twice).
- **Not run:** Playwright e2e (needs a fresh build with the e2e DB, ~10 min), SQL tests (`test:db`), CI on GitHub, Stripe test-mode payment, real phones, accessibility tooling.

## 10. Remaining problems

- Prod: no shipping zones, placeholder legal pages are publicly visible, no real product catalogue/photos/titles, and categories don't match the products.
- Licences unknown for the core 3D environment, trolley, Christmas models and store music. Trademarked files remain in git history.
- CSP still allows `'unsafe-inline'` scripts. Functions run in a US region (`iad1`). The Supabase region is unverified.
- The DB-backed limiter adds one write per sensitive request. Use Vercel WAF for volumetric attacks.
- Alerts are best effort on serverless. No client-side error reporting. No formal WCAG audit.
- The 3D store itself still weighs ~2.1 MB core + 3.3 MB seasonal models once entered. No KTX2/LOD work was done.

## 11. Founder actions

1. **Shipping:** confirm carrier/supplier prices per country, then create zones + methods in Admin → Shipping (EUR methods for EU, USD for US). The coverage panel turns green per country.
2. **Legal:** register the company identity (legal name, registered address, P.IVA/VAT, REA). Enter it in Settings and fill every bracket in Terms/Privacy/Returns. Have a lawyer review (including the rental "introductory price" wording and the privacy text on shortened IPs/analytics). Republish. Until then, consider unpublishing the pages.
3. **Catalogue:** replace or archive sample products, write real titles/descriptions from supplier specs, and fix category names (e.g. pet categories instead of Pantry/Drinks).
4. **Licences:** fill the licence register (Sketchfab authors/licences, Meshy plan, store music) or replace the assets. Decide on purging git history.
5. **Deploy config:** push migration `20261205000001_security_hardening.sql`. Set `ADMIN_MFA_KEY`, enrol, then `ADMIN_REQUIRE_MFA=super_admin`. Set `OPS_ALERT_WEBHOOK_URL`, a Plausible account + `NEXT_PUBLIC_PLAUSIBLE_DOMAIN`, and an uptime check on `/api/health`. Consider moving Vercel functions to `fra1`/`cdg1` to match the Supabase region.
6. **Stripe:** run test mode end-to-end on a preview: pay, fail, duplicate webhook, refund, cancel. Then live keys + `STRIPE_ALLOW_LIVE`.
7. **GitHub:** push to run CI. Fix anything Linux-specific it finds.
8. **Real devices:** iPhone Safari and Android Chrome (home, catalog, checkout, 3D tap-to-enter).

## 12. Launch readiness

**Not launch ready.** The software is close to "technically launch ready, external requirements remain". It is
held back by the missing shipping configuration, legal identity, real catalogue and an unverified payment run, all
of which the code now correctly refuses to work around.

## 13. Next 10 highest-value improvements

1. Configure shipping and complete the legal identity, so the first real order can happen (unblocks everything).
2. One live paid order + refund in production.
3. Curate 10–20 real products with honest titles, photos and pet-focused categories.
4. Turn on Plausible and read the 3D-vs-catalog funnel after the first ~500 visits.
5. Put a small acquisition test (one channel) behind the funnel.
6. Move functions to an EU region, plus Vercel WAF rules for OTP/checkout/login.
7. Run the Playwright suite in CI and add a mobile checkout e2e with the dev payment simulator.
8. KTX2 textures + LOD for `supermarket.opt.glb`, targeting a <1.5 MB core store.
9. A PDP/cart/checkout design pass (mobile), with an axe accessibility check in e2e.
10. Keep multiplayer/voice off unless the funnel shows the 3D store converts. Then add a TURN relay and server-side reporting.
