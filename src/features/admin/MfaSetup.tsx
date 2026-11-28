"use client";
/** Two-factor set-up: start → add the key to an authenticator app → confirm with a code → save recovery codes. */
import { useActionState } from "react";
import type { ActionResult } from "@/lib/admin/guard";
import { SubmitButton } from "./ActionForm";

type Action<T> = (prev: ActionResult<T> | null, fd: FormData) => Promise<ActionResult<T>>;

export function MfaSetup({ start, confirm }: { start: Action<{ secret: string; uri: string }>; confirm: Action<{ recoveryCodes: string[] }> }) {
  const [started, startAction] = useActionState(start, null);
  const [confirmed, confirmAction] = useActionState(confirm, null);
  const setup = started?.ok ? (started.data ?? null) : null;
  const codes = confirmed?.ok ? (confirmed.data?.recoveryCodes ?? null) : null;

  if (codes) {
    return (
      <div className="space-y-3 text-sm">
        <p className="font-semibold text-emerald-800">Two-factor sign-in is on.</p>
        <p>Save these recovery codes somewhere safe (a password manager). Each works once if you lose your phone. They are not shown again.</p>
        <ul className="grid grid-cols-2 gap-2 rounded-xl bg-ink p-4 font-mono text-sm text-cream" aria-label="Recovery codes">
          {codes.map((c) => <li key={c}>{c}</li>)}
        </ul>
      </div>
    );
  }

  return (
    <div className="space-y-4 text-sm">
      {!setup && (
        <form action={startAction} className="space-y-2">
          <p>Use an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Authy…). After this, signing in needs your password <b>and</b> a 6-digit code from the app.</p>
          {started && !started.ok && <p role="alert" className="text-red-700">{started.error}</p>}
          <SubmitButton>Set up two-factor sign-in</SubmitButton>
        </form>
      )}
      {setup && (
        <form action={confirmAction} className="space-y-3">
          <ol className="list-decimal space-y-2 pl-5">
            <li>
              In your authenticator app choose <i>Add account → Enter a setup key</i> (time-based) and type this key:
              <code className="mt-1 block break-all rounded-lg bg-ink px-3 py-2 font-mono text-cream">{setup.secret.replace(/(.{4})/g, "$1 ").trim()}</code>
              On a phone you can also <a className="underline" href={setup.uri}>open it in the app</a>.
            </li>
            <li>Enter the 6-digit code the app shows:</li>
          </ol>
          <input name="code" inputMode="numeric" autoComplete="one-time-code" required minLength={6} maxLength={12} placeholder="123 456" aria-label="Code from the app" className="admin-input !w-48 font-mono tracking-widest" />
          {confirmed && !confirmed.ok && <p role="alert" className="text-red-700">{confirmed.error}</p>}
          <SubmitButton>Turn on</SubmitButton>
        </form>
      )}
    </div>
  );
}
