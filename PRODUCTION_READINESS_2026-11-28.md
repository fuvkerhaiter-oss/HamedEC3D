# WEGO SHIIIP — Production readiness report (2026-11-28)

Everything here is in your **local working tree**: nothing is committed, pushed, deployed or migrated. No production data was touched, no payment was made, and no secret was printed or written.

---

## A. Executive summary

I re-checked the remediation from earlier today and found it present and working. Then I fixed what the final pass turned up:

- **A real bug in Admin → Shipping:** every weight-based shipping method was refused when you tried to save it. A regex was missing a backslash (`/^d+$/`), so "0-2000: 6.90" always failed. The bug was already in the code before today's remediation. Now fixed and tested.
- **Shipping zones:** a mistyped country code (e.g. `UK`, `EL`) used to be silently dropped. It is now refused with a clear message, and the admin form lists the codes you can use.
- **Publishing products:** a product now needs a photo, a description of at least 40 characters, a category and a price on every active variant before it can go live. Sample products can't be published in production at all. A CSV import that asks for "published" keeps failing rows as drafts and tells you why, instead of skipping them silently.
- **`/api/health`:** now reports `checkout: true` only when an order could really be placed. That means payments are configured, the legal gate passes and at least one country has a priced shipping method. It still returns booleans only.
- **Ops alerts:** they now finish sending inside a serverless function, instead of possibly being cut off when the response ends.
- **Analytics:** a `search` event now reports a result-count bucket only (`0`, `1-5`, `6+`), never the search text.
- **Accessibility:** a new axe-core check runs on 7 pages, on desktop and phone. It found and I fixed:
  - the cart button's accessible name didn't contain its visible text;
  - the 3D-store portal button had the same problem;
  - the "Go" price-filter button had the same problem;
  - the "No photo yet" text had low contrast;
  - two horizontal scroll areas couldn't be reached by keyboard;
  - the error page had no `<title>`.
- **A stale home-page e2e test**, broken by this morning's redesign, is updated.
- **Deployment region:** I checked it and it is correct, so I left it as is. Production uses Supabase project `xgplrcvnpzjczsfnxcge` (read from the live CSP header). Its database host resolves to AWS **us-east-1**, the same region as Vercel `iad1`. Moving the functions to the EU would add latency on every query. EU data residency is a contract and privacy-policy question for you (see F6), not a code change.
- **Old doc entry:** `PROJECT_STATUS.md` names project `xnmgiluewsjbaqlhlfim`, which is outdated. `.mcp.json` and production use `xgplrcvnpzjczsfnxcge`.

Results: all automated checks pass locally (D). **Production still can't sell** until you complete the owner actions (F). The code refuses to sell without them; that is intended.

## B. Production readiness scores (technical, 0–10)

| Area | Score | Why |
|---|---|---|
| Engineering | 7.5 | Clean architecture, strict types, 271 unit + 82 integration + 27 e2e tests |
| Security | 7.5 | Shared rate limits, TOTP MFA (not yet enrolled), RLS on every table, fail-closed gates; CSP still has `'unsafe-inline'` |
| Reliability | 6.5 | Health check, alerts, outbox/jobs; alerts are webhook-based, not a full APM; nothing verified in production yet |
| Checkout readiness | 5 | Code path fully tested with the simulator and Stripe fixtures; **no real Stripe test-mode run, no shipping zones, legal gate closed in production** |
| Deployment readiness | 6 | Build OK, CI file ready, migration plan below; CI has never run, migration not applied |
| UX | 6.5 | Catalog-first home, sticky mobile cart bar, honest pricing |
| Mobile | 7 | Phone e2e and axe at 375 px pass; no real-device test |
| Performance | 6 | Home 0.89 MB on mobile (measured earlier today); 3D core ~2.1 MB once entered; no KTX2/LOD |
| Accessibility | 6.5 | Axe A/AA: 0 serious/critical on 6 pages × 2 viewports; no manual screen-reader audit; the 3D canvas is not accessible (the catalog is the alternative) |
| SEO | 7 | Sitemap, robots, canonical URLs, product JSON-LD; samples and drafts excluded |
| **Overall technical readiness** | **6.5** | The code is ready for a controlled launch; the external setup isn't |

## C. Changes made in this pass (on top of the uncommitted remediation)

| File | Change |
|---|---|
| `src/lib/shipping/quote.ts` | New pure `parseRateTiers()` (exact money, whole-gram weights) and `parseZoneCountries()` |
| `src/app/admin/(panel)/ops-actions.ts` | Uses both parsers; fixes the weight-tier regex bug; refuses non-market country codes |
| `src/app/admin/(panel)/shipping/page.tsx` | Lists valid country codes and explains zone priority |
| `src/lib/admin/services/products.ts` | Publish gate (photo, description ≥ 40, no samples in prod); CSV `keptDraft` report |
| `src/app/admin/(panel)/products/actions.ts` | CSV import message lists products kept as drafts |
| `src/app/api/health/route.ts` | Real checkout-readiness check (booleans only, 3 s timeouts) |
| `src/lib/monitoring.ts` | Alert delivery registered with `after()` |
| `src/lib/analytics/events.ts`, `catalog/page.tsx` | `search` event with result bucket only |
| `src/components/CartButton.tsx`, `features/home/StorePortal.tsx`, `components/catalog/CatalogControls.tsx`, `features/catalog/ProductDetail.tsx`, `app/(site)/catalog/[slug]/page.tsx`, `app/(site)/page.tsx`, `app/(site)/error.tsx` | Accessibility fixes |
| `tests/e2e/a11y.spec.ts` (new), `package.json` / lock | Axe check; dev dependency `@axe-core/playwright` |
| `tests/unit/shipping-coverage.test.ts`, `tests/unit/launch-hardening.test.ts`, `tests/integration/products.test.ts`, `tests/e2e/admin.spec.ts`, `tests/e2e/smoke.spec.ts` | New and updated tests |

## D. Tests (actual results, this machine, 2026-11-28)

| Check | Result |
|---|---|
| `npm run typecheck` | ✅ clean |
| `npm run lint` | ✅ clean |
| `npm run test:unit` | ✅ **271/271** |
| `npm run test:integration` (embedded Postgres, all migrations) | ✅ **82/82** |
| `npm run test:db` (SQL RLS + constraints, fresh DB with all 17 migrations incl. `20261205000001`) | ✅ ok |
| `npm run test:e2e` (fresh DB → production build → Playwright, Edge) | ✅ **27 passed, 2 skipped** (the 2 skips are `/pages/terms` in the a11y spec: that page doesn't exist in the e2e seed) |
| — of which accessibility (axe, WCAG 2.0/2.1 A+AA, serious/critical) | ✅ 12/12 pages × viewports pass |
| `npm run build` | ✅ OK |
| `npm audit` | ✅ 0 vulnerabilities |
| GitHub CI | ⏳ **NOT RUN**: runs when you push |
| Stripe test-mode payment against Stripe's servers | ⏳ **NOT RUN** (yours, see H5) |
| Real phone, real screen reader | ⏳ **NOT RUN** |

The first e2e run of this pass had 13 failures: 12 accessibility violations and 1 stale home-page test. All were fixed and the second full run passed. No test was removed or weakened. The only test changes are new locators for the renamed cart label, the new home headline, and the photo/description now required to publish.

## E. Go / No-go checklist

| Requirement | Status | Evidence / what's missing |
|---|---|---|
| Build | PASS | `npm run build` + e2e production build |
| Tests | PASS | D |
| CI | NOT VERIFIED | Workflow ready (`.github/workflows/ci.yml`), never run |
| Database migration | OWNER ACTION | `20261205000001` (and possibly earlier ones) not applied in prod; see H2 |
| Database compatibility | PASS WITH LIMITATIONS | All migrations apply cleanly to a fresh DB + RLS tests pass; prod migration state unknown to me |
| Checkout (code) | PASS WITH LIMITATIONS | Server pricing, stock hold, idempotency, state machine tested; real Stripe not run |
| Shipping | BLOCKED → OWNER ACTION | Prod has 0 zones (verified on live: 422 for IT/DE/US) |
| Stripe | OWNER ACTION | Test-mode run on a preview, then live keys |
| Webhooks | PASS WITH LIMITATIONS | Signature, dedupe, re-verification, amount match tested with fixtures; live endpoint not checked |
| Seller identity | BLOCKED → OWNER ACTION | Settings → Seller details empty / placeholder |
| Legal pages | BLOCKED → OWNER ACTION | Live pages contain `[LEGAL COMPANY NAME]` etc.; gate refuses checkout until fixed |
| Products | OWNER ACTION | Publish gate enforced; real catalog and photos needed; samples hidden in prod |
| Asset licensing | BLOCKED → OWNER ACTION | Supermarket + trolley (Sketchfab), Christmas models, store music: licence UNKNOWN; GTA/PS5 removed locally but **still live until you deploy** |
| MFA | OWNER ACTION | Code ready; needs `ADMIN_MFA_KEY` + enrolment + `ADMIN_REQUIRE_MFA` |
| Security | PASS WITH LIMITATIONS | Code review + tests; no pentest; CSP `'unsafe-inline'` |
| Monitoring | OWNER ACTION | `OPS_ALERT_WEBHOOK_URL` + uptime monitor on `/api/health` |
| Analytics | OWNER ACTION | `NEXT_PUBLIC_PLAUSIBLE_DOMAIN` + Plausible site |
| Health endpoint | PASS (local) / NOT VERIFIED (prod) | Not deployed yet (prod returns 404) |
| Environment variables | OWNER ACTION | Run `npm run check:env` with prod values |
| Deployment region | PASS | DB us-east-1 = Vercel iad1 (verified by DNS + AWS ranges) |
| Domain | PASS | www.wegoshiiip.com serves the app |
| SSL | PASS | HTTPS with HSTS preload header observed on live |
| SEO | PASS WITH LIMITATIONS | Technical SEO fine; real content needed |
| Accessibility | PASS WITH LIMITATIONS | Automated only |
| Mobile | PASS WITH LIMITATIONS | Emulated only |
| Performance | PASS WITH LIMITATIONS | Measured locally; not on prod |
| Privacy | OWNER ACTION | Data stored in the US (Supabase us-east-1): disclose it + transfer basis (SCCs/DPA) in the privacy policy; lawyer review |
| Post-deployment validation | OWNER ACTION | Section I |
| Rollback plan | PASS | Section J |

## F. Owner actions (exact)

1. **Shipping:** Admin → Shipping prices.
   - Create a zone (e.g. "Italy", countries `IT`; "EU", the codes you serve; "USA", `US`).
   - Add methods: EUR for EU zones, USD for the US. Use only prices confirmed by your carrier or supplier.
   - Weight tiers look like `0-2000: 6.90`, one per line.
   - The banner must show the countries you want.
2. **Seller identity:** Admin → Settings → Seller details: legal name, registered address, P.IVA/VAT, email.
3. **Legal pages:** Admin → Content.
   - Replace every `[BRACKET]` in Terms, Privacy and Returns.
   - Add the US data location to Privacy (see 6).
   - Have a lawyer review, then publish. The checkout opens only when the gate passes.
4. **Licences:** record the licence for the supermarket and trolley models (Sketchfab author + licence, attribution page if CC-BY), the Christmas models and the store music in `ASSET_INVENTORY.md`, or replace the assets.
5. **Catalog:** add real products, each with a photo and a description of 40+ characters, priced in EUR (and USD if you sell to the US). Give them pet categories instead of Pantry/Drinks.
6. **Privacy / data location:** your database is in the US (us-east-1). Sign Supabase's DPA, which includes SCCs, and state the transfer in the privacy policy. If you want EU hosting, that means a new Supabase project in an EU region plus a data migration. That is a separate project; don't do it during this launch.
7. **Admin MFA:**
   1. Generate a key locally: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
   2. Vercel → Project → Settings → Environment Variables → Production: add `ADMIN_MFA_KEY` with that value. Store a copy in your password manager. Changing it later breaks enrolled authenticators.
   3. Deploy. Sign in at `/admin` → **Security** → set up two-factor: scan the QR code, enter the code, and save the 8 recovery codes offline.
   4. Then add `ADMIN_REQUIRE_MFA=super_admin` and redeploy.
   5. If you are ever locked out: `npm run admin:reset-mfa -- --email <you>`, run with `DATABASE_URL` pointing at production.
8. **Monitoring:**
   1. Create a Slack or Discord incoming webhook and set it as `OPS_ALERT_WEBHOOK_URL` (https).
   2. Create an uptime monitor (UptimeRobot / Better Stack) on `https://www.wegoshiiip.com/api/health`, every 5 min, alerting on non-200.
   3. Add a second keyword monitor for `"checkout":true` (it tells you when selling stops).
   4. Keep Vercel log alerts on.
9. **Analytics:** create a site in Plausible for `wegoshiiip.com`. Set `NEXT_PUBLIC_PLAUSIBLE_DOMAIN=wegoshiiip.com`, and `PLAUSIBLE_HOST` only if you use an EU or self-hosted instance. In Plausible, add goals for: `add_to_cart`, `checkout_start`, `payment_start`, `purchase` (with revenue), `search`, `store3d_enter`.
10. **Environment check:** put the production values in a temporary `.env.local` (never commit it) and run `npm run check:env`. Fix every ERROR. `DEV_PAYMENT_WEBHOOK_SECRET` must not exist in production.

## G. GitHub push instructions

```powershell
git status
```
```powershell
git diff --stat
```
Review the diff. The new files are listed in `git status`. `licensing-hold/` and `.env*` are ignored and must stay out of git.
```powershell
git checkout -b release/launch-hardening
```
```powershell
git add -A
```
```powershell
git status
```
Check the list: no `.env.local`, no `licensing-hold/`, no `test-results/`.
```powershell
git commit -m "Launch hardening: legal/shipping gates, MFA, shared rate limits, monitoring, analytics, a11y"
```
```powershell
git push -u origin release/launch-hardening
```
Open a pull request into `main` and wait for the **CI** workflow (typecheck, lint, unit, integration, audit, build, e2e) to go green. Fix anything Linux-specific it finds before merging. Note: the GTA/PS5 files stay in old commits. If the repository is or will be public, ask about a history rewrite separately; it is destructive.

## H. Deployment sequence

1. **Backup:** Supabase Dashboard → Database → Backups: confirm a recent backup exists, or create one. On Pro, note the PITR time.
2. **Migrations:** on your machine, linked to project `xgplrcvnpzjczsfnxcge`:
   1. `npx supabase link --project-ref xgplrcvnpzjczsfnxcge`
   2. `npx supabase migration list` shows which of the 17 migrations are applied remotely. Expect at least `20261204000001` and `20261205000001` to be pending.
   3. `npx supabase db push --dry-run`, then `npx supabase db push`.
   4. `npm run test:db` against production is **not** safe: it uses a fresh local DB. Instead, check in the SQL editor: `select count(*) from public.rate_limit_buckets;` should return 0 rows, and `select column_name from information_schema.columns where table_name='admin_users' and column_name like 'totp%';` should return 4 rows.

   What `20261205000001` does:
   - It is additive: one new table (`rate_limit_buckets`, RLS on, no browser access) and 4 new columns on `admin_users`.
   - It adds a consistency check that existing rows satisfy (all null).
   - It replaces the table-wide `SELECT` grant on `cms_pages` for anon/authenticated with a column grant that excludes `draft_body`. The site reads pages through the server connection, so nothing user-facing changes.
   - The new code needs it: the shared limiter and MFA write to these tables. **Push the migration before deploying.** If the code ships first, the shared limiter logs errors and falls back to per-instance memory, and Admin → Security (MFA set-up) fails. Login itself still works, because it reads `select *`.
3. **Environment variables** (Vercel → Production): add `ADMIN_MFA_KEY`, `OPS_ALERT_WEBHOOK_URL` and `NEXT_PUBLIC_PLAUSIBLE_DOMAIN`. Keep `NEXT_PUBLIC_MULTIPLAYER` unset (off). Leave out `SHOW_SAMPLE_PRODUCTS`, `DEV_PAYMENT_WEBHOOK_SECRET` and `PAYMENT_PROVIDER`.
4. **Deploy a Preview first** (the PR branch) with **Stripe test keys**. Run section I on the preview URL.
5. **Stripe test-mode run on the preview** (test card `4242 4242 4242 4242`):
   1. Stripe Dashboard (test) → Webhooks → endpoint `https://<preview-url>/api/webhooks/stripe`. Subscribe to:
      - `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`
      - `payment_intent.payment_failed`
      - `charge.refunded`, `charge.refund.updated`
      - `refund.created`, `refund.updated`, `refund.failed`, `refund.succeeded`
      - `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`

      Put its `whsec_` as `STRIPE_WEBHOOK_SECRET` for Preview.
   2. Successful order: the order page shows Paid, the confirmation email arrives, and the admin order shows the payment plus the fee.
   3. Declined card `4000 0000 0000 0002`: no order is paid.
   4. Abandon checkout: the order is cancelled after 90 min and its stock is released.
   5. Stripe Dashboard → resend the same `checkout.session.completed` event: the response says `duplicate` and nothing changes.
   6. Partial refund from Admin → Orders, then a full refund: statuses and emails are correct.
   7. Book a rental in test mode.
6. **Promote to production:** set the live Stripe keys, create a live webhook (same events), and set `STRIPE_ALLOW_LIVE=true`. Deploy `main` after merging the PR.
7. **One live order** with your own card for a cheap product, then refund it from the admin. This is the only real-money step, and you do it yourself.

## I. Post-deployment verification

1. `https://www.wegoshiiip.com/api/health` returns `{"ok":true,"db":true,"checkout":true}`. `checkout:false` means shipping, legal or payments are not ready.
2. `/models/props/gta6-case.opt.glb` and `ps5.opt.glb` return 404.
3. `/pages/terms` has no `[`-bracket placeholders. The rental page shows "From €20" in EUR mode.
4. The catalog shows no "Sample product" badges.
5. Checkout: pick your country; shipping options appear; the total matches product + shipping (+ US tax).
6. `/admin` login asks for the 6-digit code after enrolment. Admin → Shipping shows "Checkout can ship to N of 28".
7. Plausible shows pageviews and events within minutes.
8. Alerts: send a test message to the webhook from Slack/Discord to confirm the channel works. The app posts there on the first real server error (at most once per error type per 10 min). Its delivery is NOT VERIFIED until that happens.
9. Vercel → Logs: no `ERROR` lines in the first 30 minutes.
10. On a real iPhone and Android phone: home, catalog, product, add to cart, checkout up to the Stripe page, and tap into the 3D store.

## J. Rollback

- **Code:** Vercel → Deployments → previous production deployment → **Promote to Production** (instant). Or revert the merge commit and redeploy.
- **Database:** `20261205000001` is additive and backward-compatible with the previous code (old code ignores the new table and columns). **Don't roll it back** when rolling back code. If you ever must undo it, the manual SQL is at the top of the migration file:
  - Dropping `rate_limit_buckets` loses only counters.
  - Dropping the `totp_*` columns **erases enrolled MFA**.
  - The `cms_pages` grant change is reversed with `grant select on public.cms_pages to anon, authenticated;`.
- **Payments:** if live checkout misbehaves, remove `STRIPE_ALLOW_LIVE` or set it to anything other than `true`, then redeploy. Checkout and webhooks stop taking live payments; existing orders are unaffected.
- **Data:** restore from the Supabase backup / PITR taken in H1 only as a last resort; it discards later orders.

## K. Final verdict

**READY FOR CONTROLLED DEPLOYMENT, WITH OWNER ACTIONS.**

The code can be pushed and deployed safely. It fails closed, so it will not take an order until shipping, seller identity and legal pages are complete. It is **not** ready to sell to the public until you complete F1–F4 and the Stripe test-mode run (H5). The asset licences (F4) also block a public launch.

### Known limitations (not fixed, deliberately)
- CSP keeps `'unsafe-inline'` for scripts: nonces would force every page to render dynamically. No XSS sink was found.
- The shared limiter adds one database write per sensitive request. For volumetric attacks, add Vercel Firewall rules.
- 3D: no KTX2 / LOD work. The core store is ~2.1 MB once entered. The touch-HUD cart button inside the 3D store still uses "Open cart" as its name (outside the axe scope).
- The multiplayer/voice code exists but is off in production; it needs a TURN relay and a privacy-policy update before enabling.
