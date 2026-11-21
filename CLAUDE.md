# CLAUDE.md

WEGO SHIIIP. (tagline "Happy Family, Happy Animals"; formerly Mega Market, Virtual Shopping World): first-person 3D supermarket + custom dropshipping store (Next.js, R3F, Supabase, Stripe). Markets: EU (EUR) + US (USD).
Start every session with `PROJECT_STATUS.md` (state, next action). Design: `ARCHITECTURE.md`. Setup: `INTEGRATION_GUIDE.md`.

## Rules
- Money = integer minor units (`src/lib/money.ts`). Never floats.
- Prices/stock/totals computed server-side (`lib/cart/pricing.ts`); never trust client prices, stock or payment status.
- Order status only via `transitionOrder` (`lib/orders/state-machine.ts`).
- No secrets in client code; only `NEXT_PUBLIC_*` reach the browser.
- Label mocks clearly; never present mock suppliers/payments as real integrations.
- Before finishing a phase: typecheck, lint, relevant tests, build.

## Skills (`.claude/skills/`)
- **token-efficient-engineering** — every session: read minimally, targeted edits/tests, keep `PROJECT_STATUS.md` updated.
- **3d-web-game** — scene, first-person controller, camera, physics, interactions, lighting, FPS work.
- **glb-asset-optimization** — importing/inspecting/optimizing GLB models, instancing, LOD, lazy loading. Never replace real assets or fake products without permission.
