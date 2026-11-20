"use client";
/** Form bound to an admin server action: pending state, error/success message, optional confirm. */
import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import type { ActionResult } from "@/lib/admin/guard";

type Action = (prev: ActionResult | null, fd: FormData) => Promise<ActionResult>;

export function SubmitButton({ children, variant = "primary", className = "" }: { children: React.ReactNode; variant?: "primary" | "ghost" | "danger"; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={`btn-${variant} ${className}`} aria-busy={pending}>
      {pending ? "Working…" : children}
    </button>
  );
}

export function ActionForm({
  action, children, submitLabel, variant = "primary", confirm, resetOnSuccess = false, className = "", inline = false, hideMessage = false,
}: {
  action: Action;
  children?: React.ReactNode;
  submitLabel?: React.ReactNode;
  variant?: "primary" | "ghost" | "danger";
  confirm?: string;
  resetOnSuccess?: boolean;
  className?: string;
  inline?: boolean;
  hideMessage?: boolean;
}) {
  const [state, formAction] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;
  return (
    <form
      ref={ref}
      action={formAction}
      className={inline ? `inline-flex flex-wrap items-center gap-2 ${className}` : `space-y-3 ${className}`}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {children}
      {submitLabel && <SubmitButton variant={variant}>{submitLabel}</SubmitButton>}
      {!hideMessage && state && (
        <p role={state.ok ? "status" : "alert"} className={`text-sm ${state.ok ? "text-emerald-700" : "text-red-700"}`}>
          {state.ok ? state.message ?? "Saved." : state.error}
          {fieldErrors && (
            <span className="mt-1 block text-xs">
              {Object.entries(fieldErrors).map(([k, v]) => <span key={k} className="block">{k}: {v}</span>)}
            </span>
          )}
        </p>
      )}
    </form>
  );
}
