import { ActionForm } from "@/features/admin/ActionForm";
import { MfaSetup } from "@/features/admin/MfaSetup";
import { Card, Field, Notice, PageHeader } from "@/features/admin/ui";
import { recoveryCodesLeft } from "@/lib/admin/auth";
import { needsMfaEnrollment, requirePage } from "@/lib/admin/guard";
import { mfaKey, mfaRequiredFor } from "@/lib/admin/totp";
import { getSql } from "@/lib/db/client";
import { mfaConfirmAction, mfaDisableAction, mfaStartAction } from "./actions";

export const metadata = { title: "Security" };
export const dynamic = "force-dynamic";

export default async function SecurityPage() {
  const session = await requirePage("dashboard.view", { allowWithoutMfa: true });
  const on = session.user.mfaEnabled;
  const left = on ? await recoveryCodesLeft(getSql(), session.user.id) : 0;
  const configured = Boolean(mfaKey());
  return (
    <>
      <PageHeader title="Security" description="Protect your admin account with two-factor sign-in." />
      <div className="max-w-2xl space-y-4">
        {needsMfaEnrollment(session) && (
          <Notice tone="warn" title="Two-factor sign-in is required">
            This shop requires two-factor sign-in for your role. Set it up below to continue using the admin.
          </Notice>
        )}
        {!configured && !on && (
          <Notice tone="warn" title="Not available on this server yet">
            The owner must set <code>ADMIN_MFA_KEY</code> (32+ random characters, kept secret) in the server environment. Secrets are stored encrypted with it.
          </Notice>
        )}
        <Card title="Two-factor sign-in">
          {on ? (
            <div className="space-y-4 text-sm">
              <p className="font-semibold text-emerald-800">On. Signing in needs your password and a code from your app.</p>
              <p>Recovery codes left: <b>{left}</b>{left <= 2 && " — turn two-factor off and on again to get new ones."}</p>
              {!mfaRequiredFor(session.user.role) && (
                <details className="rounded-xl border border-dashed border-line">
                  <summary className="cursor-pointer px-4 py-2.5 font-medium">Turn off two-factor sign-in</summary>
                  <div className="border-t border-line p-4">
                    <ActionForm action={mfaDisableAction} submitLabel="Turn off" variant="danger" confirm="Turn off two-factor sign-in for your account?">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="Your password"><input name="password" type="password" autoComplete="current-password" required className="admin-input" /></Field>
                        <Field label="Code from your app (or a recovery code)"><input name="code" autoComplete="one-time-code" required className="admin-input font-mono" /></Field>
                      </div>
                    </ActionForm>
                  </div>
                </details>
              )}
            </div>
          ) : (
            <MfaSetup start={mfaStartAction} confirm={mfaConfirmAction} />
          )}
        </Card>
        <p className="text-xs text-ink-soft">
          Lost your phone and your recovery codes? The owner can remove two-factor from an account with <code>npm run admin:reset-mfa -- --email name@yourdomain</code> (needs database access).
        </p>
      </div>
    </>
  );
}
