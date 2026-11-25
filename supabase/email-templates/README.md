# Supabase Auth email templates — WEGO SHIIIP

Supabase Auth sends the sign-in OTP. The app's own Resend key does **not** send these emails; it only sends order, contact and withdrawal mail.

## Paste this template

1. Open **Supabase Dashboard → Authentication → Emails**.
2. Edit **Magic Link** and **Confirm signup** (new users may use either).
3. Subject:
   ```
   Your WEGO SHIIIP verification code: {{ .Token }}
   ```
4. Body: paste the full contents of [`magic-link.html`](./magic-link.html).
5. Save both templates.

The important part is `{{ .Token }}`. If the template only contains `{{ .ConfirmationURL }}`, the customer receives a link but the sign-in window asks for a 6–8 digit code, so they cannot continue.

## Custom SMTP (required for real delivery)

**Authentication → Emails → SMTP Settings**:

| Setting | Value |
|---|---|
| Host | `smtp.resend.com` |
| Port | `465` (SSL) or `587` (STARTTLS) |
| Username | `resend` |
| Password | your Resend API key (`re_...`) |
| Sender email | `orders@wegoshiiip.com` |
| Sender name | `WEGO SHIIIP` |

> **Sender email must be a bare address.** Do not paste `WEGO SHIIIP <orders@wegoshiiip.com>` into the Sender email field; the display name belongs in Sender name. Resend's SMTP relay rejects the former with `501 Error: Bad sender address syntax`, and Supabase reports it only as `Error sending confirmation email`.

## Checklist

- Resend → Domains → `wegoshiiip.com` shows **Verified** (not `partially_verified`).
- The `rsend` CNAME exists: `rsend` → `rsend-euw1.forge.rmta.net`, DNS-only (no proxy).
- Supabase Auth → Logs shows no `Error sending confirmation email`.
- Request a fresh code after changing SMTP; old codes expire.

## If it still says “Error sending confirmation email”

The Resend side has been tested directly: `smtp.resend.com:465` authenticates with username `resend` and the API key, and a message from `orders@wegoshiiip.com` is accepted and delivered. So this error means Supabase is not sending the values below verbatim. Check, in order:

1. **Sender email contains no display name or angle brackets.** Use `orders@wegoshiiip.com` exactly.
2. **No trailing space or newline** in the Sender email, Username (`resend`) or Password. Paste the key with a plain paste, not from a formatted note.
3. **Port and encryption match**: `465` with SSL, or `587` with STARTTLS. Don’t use 465 with STARTTLS.
4. **Custom SMTP is enabled and saved** in the project the site actually uses: `xgplrcvnpzjczsfnxcge`, not the repo-linked `xnmgiluewsjbaqlhlfim`.
5. Open **Authentication → Logs**, search the `error_id` returned by the app, and read the underlying SMTP response. A `501` means a malformed sender; `535` means a bad password; a timeout means the wrong port/TLS mode.

After saving, request one fresh code and wait for the app’s own 60-second resend window.
