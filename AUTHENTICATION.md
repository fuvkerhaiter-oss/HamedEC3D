# WEGO SHIIIP — Customer Authentication System Architecture & Setup Guide

This document describes the optional customer authentication system implemented inside **WEGO SHIIIP**, detailing architecture, security guarantees, guest preservation, cart migration, and the exact steps required to configure Resend and Google OAuth in production.

---

## 1. Architectural Overview

WEGO SHIIIP introduces a frictionless, three-tier visitor experience:

1. **Continue as Guest (Zero Commitment)**: Visitors can immediately enter, explore the 3D supermarket, browse products, add items to their trolley, modify quantities, switch markets, and complete checkout as a guest. Authentication is **never mandatory**.
2. **Passwordless Email OTP**: Users can sign in or create an account using their email address. A 6–8 digit verification code (8 digits on the hosted project) is delivered through Resend, establishing a secure session without passwords.
3. **Continue with Google**: Returning and new users can authenticate with 1-click Google OAuth 2.0 PKCE.

### Separation of Customer & Administrative Auth
- **Customer Authentication**: Powered by Supabase Auth (`auth.users`, `public.profiles`, `public.addresses`, `public.carts`, `public.orders`), managed via `@supabase/ssr` with HttpOnly encrypted cookies.
- **Administrative Authentication**: Completely separated in `public.admin_users`, `public.admin_sessions`, using scrypt password hashing, session sha256 tokens, and permission guards in `src/lib/admin/guard.ts`. The admin system remains strictly isolated and unmodified.

---

## 2. Core Features & UX Implementation

### Strategic Entry Points
Authentication is integrated naturally without modal bombardment:
- **Header Account Button (`AccountNavButton`)**:
  - Displays "Sign In" with a shopper icon for guests.
  - Displays user initial/avatar badge with a dropdown menu ("Overview", "Orders", "Saved Addresses", "Security & Privacy", "Sign Out") for authenticated shoppers.
- **Interactive Auth Modal (`AuthModal`)**:
  - Funny, premium supermarket design with bouncing trolley animation, receipts, and playful copy ("No paperwork. No commitment. Just your trolley.", "One tiny verification code. Zero suspicious vegetables.").
  - Full keyboard accessibility (Esc dismiss, numeric OTP auto-advance, backspace navigation, 6–8 digit paste support).
  - Countdown timer for code resend (60 seconds) with rate-limiting protection.
  - 1-click Google button adhering to Google's official branding guidelines.
- **Cart Drawer (`CartDrawer`)**:
  - Subtle guest banner: *"Shopping as guest? Sign in to save trolley"*.
- **Checkout (`CheckoutForm`)**:
  - Guest checkout remains completely open and functional.
  - Option to sign in to auto-fill saved delivery addresses.
  - Authenticated orders are automatically associated with the user's `userId`.

---

## 3. Guest Mode & Cart Merging Engine

### Guest Cart Preservation
- Guest carts live in browser local storage (`vsw-cart` via Zustand persist).
- Visitors can explore, add, remove, and price items without an account.
- When an authenticated user signs out, their local guest trolley is preserved rather than destructively wiped.

### Authoritative Cart Merging (`src/lib/cart/merge.ts`)
When a guest signs in or creates an account:
1. `useAuth` detects the `SIGNED_IN` event and triggers `POST /api/cart/sync`.
2. The server loads any existing account cart from `public.carts` and `public.cart_items`.
3. `mergeCartLines(guestLines, accountLines)` combines items:
   - Duplicate variants combine quantities (`guestQty + accountQty`).
   - Clamped to `MAX_LINE_QUANTITY` (99) per variant.
   - Capped at `MAX_CART_LINES` (100) unique items.
   - Invalid, negative, or zero quantities are safely ignored.
4. The merged cart is saved atomically to the database for that user.
5. Authoritative prices and stock are recalculated server-side via `/api/cart/price` (client-submitted prices are never trusted).

---

## 4. Customer Account Experience (`/account`)

- **`/account` (Overview)**:
  - Welcome greeting, VIP Shopper status, verified email, recent orders snapshot, default address summary, and quick links.
  - Unauthenticated visitors see the "Who are you today?" choice card or guest order lookup.
- **`/account/orders` (Orders View)**:
  - Authenticated shoppers see their complete order history with real-time status badges (`paid`, `shipped`, `delivered`), item counts, tracking carrier links, and total amounts.
  - Supports tokenized email links (`?t=...`) for guests who placed orders without an account.
  - When a user creates an account, prior guest orders placed with that verified email are automatically claimed and linked to their account via migration trigger `handle_new_user()`.
- **`/account/addresses` (Saved Addresses)**:
  - Add delivery addresses for EU and US destinations with validation.
  - Set default address (automatically demoting previous default).
  - Delete saved addresses.
- **`/account/security` (Security & Privacy)**:
  - View authenticated email, sign-in provider, and session info.
  - "Sign Out Everywhere" action.
  - GDPR Data Deletion: allows customers to delete their profile, saved addresses, and active sessions while retaining immutable fiscal transaction snapshots for EU tax compliance.

---

## 5. Security Engineering

- **Server-Side Identity Verification**: User identity is derived strictly from server-validated JWT tokens using `supabase.auth.getUser()`. User IDs sent in request bodies are never trusted.
- **Open-Redirect Hardening**: Auth callback (`/auth/callback/route.ts`) sanitizes redirect parameters with `sanitizeRedirect()` to reject protocol-relative URLs (`//evil.com`), backslash escapes (`/\evil.com`), external protocols, or javascript URIs.
- **Rate-Limiting**:
  - `POST /api/auth/otp`: limited to 5 requests per minute per IP, and 3 requests per minute per email.
  - OTP verification: limited to 10 attempts per minute per IP to prevent brute-forcing.
- **Row Level Security (RLS)**:
  - Customers can read and update only their own profile (`public.profiles`).
  - Customers can manage only their own addresses (`public.addresses`) and carts (`public.carts`).
  - Customers can read only orders matching their `user_id` or verified email JWT claim (`public.orders`).

---

## 6. Production Setup Instructions

### A. Supabase Project Configuration
1. Go to your [Supabase Dashboard](https://supabase.com/dashboard).
2. Under **Project Settings → API**:
   - Copy **Project URL** → set as `NEXT_PUBLIC_SUPABASE_URL`.
   - Copy **anon public key** → set as `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
   - Copy **service_role secret key** → set as `SUPABASE_SECRET_KEY` (server only).
3. Apply migrations to your Supabase project:
   ```bash
   npx supabase db push
   ```
   (This applies `20261127000001_customer_auth_enhancements.sql` which adds profile sync and guest order auto-claiming).

### B. Email Delivery via Resend (Passwordless OTP)
To send verification codes through Resend using Supabase Auth:
1. In your [Resend Dashboard](https://resend.com):
   - Verify your sending domain (e.g., `your-domain.com`).
   - Create an API Key under **API Keys** with "Sending access".
2. In your [Supabase Dashboard](https://supabase.com/dashboard):
   - Navigate to **Authentication → Email Settings → SMTP Settings**.
   - Enable **Custom SMTP**.
   - **Sender email**: `orders@your-domain.com` (or your verified domain).
   - **Sender name**: `WEGO SHIIIP`
   - **Host**: `smtp.resend.com`
   - **Port**: `465` (SSL) or `587` (TLS)
   - **User**: `resend`
   - **Password**: `<YOUR_RESEND_API_KEY>`
3. In **Authentication → Emails → Magic Link** and **Confirm signup**:
   - Set Subject: `Your WEGO SHIIIP verification code: {{ .Token }}`
   - Paste the branded template from [`supabase/email-templates/magic-link.html`](./supabase/email-templates/magic-link.html).
   - `{{ .Token }}` is essential: the sign-in window asks for a 6–8 digit code, so a link-only template leaves the customer stuck.
   - The template only uses inline styles, so it renders in Gmail, Outlook, Apple Mail and mobile clients.

### Troubleshooting: the code screen appears but no email arrives

- **The Resend log is empty.** Supabase Auth sends OTP emails itself. The app's `RESEND_API_KEY` only sends order, contact and withdrawal email. Configure **Custom SMTP** above (or a Supabase Send Email Hook) so Supabase uses Resend.
- **Resend shows `partially_verified`.** Sending is still blocked (`403 — domain is not verified`). Add the missing DNS record `rsend` → `rsend-euw1.forge.rmta.net` (CNAME, DNS-only, no proxy), then press **Verify** in Resend. Wait for **Verified**.
- **Check Supabase Auth → Logs.** A line such as `Error sending confirmation email` is the SMTP/domain error; `Email rate limit exceeded` means the built-in email service is still active. Search the `error_id` returned by `/api/auth/otp` to find the exact SMTP response.
- **`Error sending confirmation email` despite valid Resend credentials.** The Sender email field must be the bare address `orders@wegoshiiip.com`. If it contains `WEGO SHIIIP <orders@wegoshiiip.com>`, Resend's SMTP relay returns `501 Bad sender address syntax`. Remove any trailing spaces/newlines from the Sender email, Username (`resend`) and Password, and make sure the port matches the encryption: `465` with SSL, or `587` with STARTTLS.
- **Check the template.** It must contain `{{ .Token }}`, not only `{{ .ConfirmationURL }}`.
- Request a new code after fixing SMTP; the previous code expires. The app limits each email to 3 requests per minute, so wait for that window before retrying.

### C. Google OAuth Configuration
1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Under **APIs & Services → Credentials**:
   - Configure **OAuth consent screen** (User Type: External, App Name: `WEGO SHIIIP`, Support Email: your support email).
   - Create **OAuth client ID** (Application type: **Web application**).
   - Under **Authorized redirect URIs**, add your Supabase Auth callback URI:
     `https://<YOUR_SUPABASE_PROJECT_REF>.supabase.co/auth/v1/callback`
3. In your [Supabase Dashboard](https://supabase.com/dashboard):
   - Navigate to **Authentication → Providers → Google**.
   - Toggle **Enable Google provider**.
   - Enter your **Client ID** and **Client Secret** obtained from Google Cloud.
4. In **Authentication → URL Configuration**:
   - **Site URL**: `https://www.your-domain.com` — it must be the exact host that serves this app. Do not use an apex domain that points at a registrar or another host.
   - **Redirect URLs**:
     - `http://localhost:3000/auth/callback`
     - `https://www.your-domain.com/auth/callback`

> **Exact match matters.** Supabase compares redirect URLs literally and the app sends `https://www.your-domain.com/auth/callback` with no query string. If that exact URL is missing, Supabase silently falls back to the **Site URL**, so the browser can land on the wrong domain after Google. Add `https://www.your-domain.com/**` if you need wildcard coverage.
>
> **The Client ID and Client Secret must come from the same Google client.** A secret from another client (or an old secret after pressing *Reset secret*) produces `error=server_error&error_code=unexpected_failure&error_description=Unable to exchange external code` right after the consent screen.

---

## 7. Implementation & Testing Status Matrix

| Component | Status | Verification Details |
|---|---|---|
| **Guest Mode** | ✅ Implemented & Tested | Guest browsing, catalog, 3D store, cart, and checkout function with zero account requirement. |
| **Cart Merging** | ✅ Implemented & Tested | Unit tests in `tests/unit/cart-merge.test.ts` pass (combining duplicates, clamping, capping). |
| **Auth Security** | ✅ Implemented & Tested | Unit tests in `tests/unit/auth-security.test.ts` pass (redirect sanitization, open-redirect prevention). |
| **Account Management** | ✅ Implemented & Tested | Integration tests in `tests/integration/account-auth.test.ts` pass (order linking, address CRUD, cart sync). |
| **All Existing Suites** | ✅ Verified | All 192 unit tests and 61 integration tests pass. |
| **Production Build** | ✅ Verified | `next build` compiles and optimizes all static and dynamic pages with 0 errors. |
| **Live Resend SMTP** | ⚙️ Ready for Config | Integrated via Supabase SMTP; requires entering `RESEND_API_KEY` into Supabase Dashboard. |
| **Live Google OAuth** | ⚙️ Ready for Config | Flow implemented with PKCE; requires Google Cloud Client ID/Secret in Supabase Dashboard. |

---

## 8. Summary of Added Files

- **`supabase/migrations/20261127000001_customer_auth_enhancements.sql`**: Database migration for profile metadata, order linking trigger, and RLS policies.
- **`src/lib/supabase/client.ts`**: Browser Supabase client via `@supabase/ssr`.
- **`src/lib/supabase/server.ts`**: Server-side Supabase client with secure session validation.
- **`src/lib/supabase/middleware.ts`**: SSR cookie session refresher.
- **`src/middleware.ts`**: Next.js proxy middleware.
- **`src/app/auth/callback/route.ts`**: OAuth PKCE callback handler with open-redirect protection.
- **`src/app/auth/signout/route.ts`**: Server-side sign-out handler.
- **`src/lib/cart/merge.ts`**: Pure cart merging logic.
- **`src/lib/cart/persistence.ts`**: Server database cart persistence for authenticated users.
- **`src/app/api/cart/sync/route.ts`**: Cart synchronization API.
- **`src/app/api/auth/otp/route.ts`**: Rate-limited email OTP send and verify API.
- **`src/lib/account/addresses.ts`**: Customer address management services.
- **`src/app/api/account/addresses/route.ts`**: Customer address CRUD endpoints.
- **`src/app/api/account/addresses/[id]/route.ts`**: Address delete and set-default endpoints.
- **`src/app/api/account/delete/route.ts`**: GDPR data deletion and account anonymization endpoint.
- **`src/features/auth/auth-store.ts`**: Auth UI Zustand store.
- **`src/features/auth/useAuth.ts`**: Reactive auth hook with automatic cart sync.
- **`src/features/auth/AuthModal.tsx`**: Witty, premium supermarket authentication modal.
- **`src/features/auth/AccountNavButton.tsx`**: Header account menu button.
- **`src/features/auth/AccountAuthEntry.tsx`**: Embedded account entry component.
- **`src/features/account/AddressManager.tsx`**: Interactive customer address manager.
- **`src/features/account/SecuritySettings.tsx`**: Interactive security and account deletion settings.
- **`src/app/(site)/account/page.tsx`**: Account overview dashboard.
- **`src/app/(site)/account/orders/page.tsx`**: Customer order history with live tracking.
- **`src/app/(site)/account/addresses/page.tsx`**: Saved addresses page.
- **`src/app/(site)/account/security/page.tsx`**: Security and session management page.
- **`tests/unit/cart-merge.test.ts`**: Unit test suite for cart merging.
- **`tests/unit/auth-security.test.ts`**: Unit test suite for auth security & sanitization.
- **`tests/integration/account-auth.test.ts`**: Integration test suite for customer auth, orders, and addresses.
