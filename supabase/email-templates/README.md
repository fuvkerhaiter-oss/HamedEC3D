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

The important part is `{{ .Token }}`. If the template only contains `{{ .ConfirmationURL }}`, the customer receives a link but the sign-in window asks for a 6-digit code, so they cannot continue.

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

## Checklist

- Resend → Domains → `wegoshiiip.com` shows **Verified** (not `partially_verified`).
- The `rsend` CNAME exists: `rsend` → `rsend-euw1.forge.rmta.net`, DNS-only (no proxy).
- Supabase Auth → Logs shows no `Error sending confirmation email`.
- Request a fresh code after changing SMTP; old codes expire.
