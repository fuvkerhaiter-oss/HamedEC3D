"use client";

import { ArrowLeft, ChevronRight, CircleCheck, LoaderCircle, LogIn, MailCheck, ShoppingBag, TriangleAlert, UserPlus, X } from "lucide-react";
import { IconTile } from "@/components/IconTile";
import { useEffect, useRef, useState } from "react";
import { useAuthStore } from "./auth-store";
import { useAuth } from "./useAuth";

function GoogleIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
      />
    </svg>
  );
}

export function AuthModal() {
  const { isOpen, mode, email, closeAuth, setMode, setEmail } = useAuthStore();
  const { signInWithGoogle } = useAuth();

  const [expectedLength, setExpectedLength] = useState(8);
  const [otp, setOtp] = useState(["", "", "", "", "", "", "", ""]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendSeconds, setResendSeconds] = useState(60);

  const otpInputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Escape key closes modal
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeAuth();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, closeAuth]);

  // Resend countdown timer
  useEffect(() => {
    if (mode !== "otp" || resendSeconds <= 0) return;
    const timer = setInterval(() => {
      setResendSeconds((s) => Math.max(0, s - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [mode, resendSeconds]);

  // Auto-focus first OTP input when entering OTP mode
  useEffect(() => {
    if (mode === "otp") {
      const t = setTimeout(() => otpInputRefs.current[0]?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [mode, expectedLength]);

  if (!isOpen) return null;

  async function handleSendOtp(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const f = new FormData(e.currentTarget);
    const enteredEmail = String(f.get("email") ?? "").trim().toLowerCase();
    setEmail(enteredEmail);

    try {
      const res = await fetch("/api/auth/otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: enteredEmail }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to send code");

      const len = typeof data.otpLength === "number" && (data.otpLength === 6 || data.otpLength === 8) ? data.otpLength : expectedLength;
      setExpectedLength(len);
      setOtp(new Array(len).fill(""));
      setError(null);
      setResendSeconds(60);
      setMode("otp");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyOtp(codeToVerify?: string) {
    const fullCode = codeToVerify || otp.join("");
    if (fullCode.length !== expectedLength) {
      setError(`Please enter all ${expectedLength} digits of your verification code.`);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, token: fullCode }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Invalid or expired code");

      setMode("success");
      setTimeout(() => {
        closeAuth();
        window.location.reload();
      }, 1400);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function handleOtpChange(index: number, val: string) {
    // Only accept numeric
    const clean = val.replace(/\D/g, "");
    if (!clean) {
      const next = [...otp];
      next[index] = "";
      setOtp(next);
      return;
    }

    // Handle single character
    const char = clean.slice(-1);
    const next = [...otp];
    next[index] = char;
    setOtp(next);

    // Auto-advance
    if (index < expectedLength - 1) {
      otpInputRefs.current[index + 1]?.focus();
    } else {
      // Completed last digit -> auto verify
      const full = next.join("");
      if (full.length === expectedLength) {
        void handleVerifyOtp(full);
      }
    }
  }

  function handleOtpKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !otp[index] && index > 0) {
      otpInputRefs.current[index - 1]?.focus();
    } else if (e.key === "ArrowLeft" && index > 0) {
      otpInputRefs.current[index - 1]?.focus();
    } else if (e.key === "ArrowRight" && index < expectedLength - 1) {
      otpInputRefs.current[index + 1]?.focus();
    }
  }

  function handleOtpPaste(e: React.ClipboardEvent) {
    e.preventDefault();
    const rawPasted = e.clipboardData.getData("text").replace(/\D/g, "");
    if (!rawPasted) return;

    let targetLen = expectedLength;
    if (rawPasted.length === 8 && expectedLength !== 8) {
      targetLen = 8;
      setExpectedLength(8);
    } else if (rawPasted.length === 6 && expectedLength !== 6) {
      targetLen = 6;
      setExpectedLength(6);
    }

    const pasted = rawPasted.slice(0, targetLen);
    const next = new Array(targetLen).fill("");
    for (let i = 0; i < pasted.length; i++) {
      next[i] = pasted[i]!;
    }
    setOtp(next);

    const focusIdx = Math.min(pasted.length, targetLen - 1);
    otpInputRefs.current[focusIdx]?.focus();

    if (pasted.length === targetLen) {
      void handleVerifyOtp(pasted);
    }
  }

  async function handleGoogleClick() {
    try {
      setLoading(true);
      setError(null);
      await signInWithGoogle();
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
    }
  }

  const titles: Record<typeof mode, [string, React.ReactNode]> = {
    welcome: ["Welcome to WEGO SHIIIP", "Sign in to track orders and reuse saved addresses, or keep shopping as a guest."],
    signin: ["Sign in", "We'll email you a one-time code. No password needed."],
    signup: ["Create your account", "We'll email you a one-time code to confirm your address."],
    otp: ["Check your email", <>Enter the {expectedLength}-digit code we sent to <span className="font-medium text-ink">{email}</span>.</>],
    success: ["You're signed in", "Syncing your cart and saved details…"],
  };
  const [title, subtitle] = titles[mode];
  const field = "w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-sm text-ink outline-none transition placeholder:text-ink-soft/60 focus:border-ink focus:ring-4 focus:ring-amber/25";
  const googleBtn = "flex w-full items-center justify-center gap-2.5 rounded-xl border border-line bg-white px-4 py-2.5 text-sm font-semibold text-ink transition hover:bg-sand disabled:opacity-60";
  const backBtn = "inline-flex items-center gap-1.5 text-xs font-medium text-ink-soft transition hover:text-ink";
  const options = [
    { icon: ShoppingBag, label: "Continue as guest", hint: "Browse and check out without an account.", onClick: closeAuth },
    { icon: LogIn, label: "Sign in", hint: "See your orders, addresses and rented shop.", onClick: () => { setError(null); setMode("signin"); } },
    { icon: UserPlus, label: "Create an account", hint: "Save your details for faster checkout.", onClick: () => { setError(null); setMode("signup"); } },
  ];

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
    >
      <div className="vsw-fade-in absolute inset-0 bg-ink/50 backdrop-blur-[2px]" onClick={closeAuth} aria-hidden="true" />

      <div
        className="vsw-cart-pop relative flex w-full max-w-[26rem] flex-col overflow-hidden rounded-2xl bg-white shadow-[0_24px_64px_-16px_rgb(13_15_14/0.35)] ring-1 ring-ink/5"
        style={{ maxHeight: "calc(100dvh - 2rem)" }}
      >
        <header className="flex items-center justify-between border-b border-line px-6 py-4">
          <span className="font-display text-sm tracking-tight text-ink">WEGO SHIIIP</span>
          <button
            onClick={closeAuth}
            className="-mr-2 grid h-9 w-9 place-items-center rounded-lg text-ink-soft transition hover:bg-sand hover:text-ink"
            aria-label="Close"
          >
            <X aria-hidden className="h-5 w-5" strokeWidth={2} />
          </button>
        </header>

        <div className="overflow-y-auto px-6 pb-6 pt-5 sm:px-7">
          {(mode === "signin" || mode === "signup") && (
            <button type="button" onClick={() => setMode("welcome")} className={`${backBtn} mb-4`}>
              <ArrowLeft aria-hidden className="h-3.5 w-3.5" strokeWidth={2} /> All options
            </button>
          )}
          {mode === "otp" && (
            <button type="button" onClick={() => setMode("signin")} className={`${backBtn} mb-4`}>
              <ArrowLeft aria-hidden className="h-3.5 w-3.5" strokeWidth={2} /> Use a different email
            </button>
          )}

          {mode === "otp" && <IconTile icon={MailCheck} className="mb-4" />}
          {mode === "success" && <IconTile icon={CircleCheck} className="mb-4" />}

          <h2 id="auth-modal-title" className="font-display text-2xl leading-tight text-ink">{title}</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">{subtitle}</p>

          {error && (
            <div role="alert" className="mt-5 flex items-start gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-800 ring-1 ring-red-200">
              <TriangleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} />
              <span>{error}</span>
            </div>
          )}

          {mode === "welcome" && (
            <div className="mt-6 space-y-2.5">
              {options.map(({ icon: Icon, label, hint, onClick }) => (
                <button
                  key={label}
                  onClick={onClick}
                  className="group flex w-full items-center gap-3.5 rounded-xl border border-line bg-white p-3.5 text-left transition hover:border-ink/25 hover:bg-cream"
                >
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-sand text-ink">
                    <Icon aria-hidden className="h-5 w-5" strokeWidth={1.75} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-ink">{label}</span>
                    <span className="mt-0.5 block text-xs text-ink-soft">{hint}</span>
                  </span>
                  <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-ink-soft transition group-hover:translate-x-0.5 group-hover:text-ink" strokeWidth={2} />
                </button>
              ))}

              <div className="relative py-3 text-center" aria-hidden>
                <span className="absolute inset-x-0 top-1/2 border-t border-line" />
                <span className="relative bg-white px-3 text-xs text-ink-soft">or</span>
              </div>
              <button onClick={handleGoogleClick} disabled={loading} className={googleBtn}>
                <GoogleIcon />
                Continue with Google
              </button>
            </div>
          )}

          {(mode === "signin" || mode === "signup") && (
            <div className="mt-6">
              <button onClick={handleGoogleClick} disabled={loading} className={googleBtn}>
                <GoogleIcon />
                Continue with Google
              </button>

              <div className="relative my-5 text-center" aria-hidden>
                <span className="absolute inset-x-0 top-1/2 border-t border-line" />
                <span className="relative bg-white px-3 text-xs text-ink-soft">or use your email</span>
              </div>

              <form onSubmit={handleSendOtp} className="space-y-4">
                <div>
                  <label htmlFor="auth-email-input" className="mb-1.5 block text-sm font-medium text-ink">
                    Email address
                  </label>
                  <input
                    id="auth-email-input"
                    name="email"
                    type="email"
                    required
                    autoFocus
                    autoComplete="email"
                    placeholder="you@example.com"
                    defaultValue={email}
                    className={field}
                  />
                </div>
                <button type="submit" disabled={loading} className="btn-yellow w-full py-3 text-sm disabled:opacity-60">
                  {loading ? <><LoaderCircle aria-hidden className="h-4 w-4 animate-spin" /> Sending code…</> : "Email me a code"}
                </button>
              </form>
            </div>
          )}

          {mode === "otp" && (
            <div className="mt-6 space-y-5">
              <div className="flex justify-between gap-1.5 sm:gap-2" onPaste={handleOtpPaste}>
                {otp.map((digit, idx) => (
                  <input
                    key={idx}
                    ref={(el) => { otpInputRefs.current[idx] = el; }}
                    type="text"
                    inputMode="numeric"
                    autoComplete={idx === 0 ? "one-time-code" : "off"}
                    pattern="[0-9]*"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleOtpChange(idx, e.target.value)}
                    onKeyDown={(e) => handleOtpKeyDown(idx, e)}
                    className={`${expectedLength === 8 ? "h-12 text-lg" : "h-14 text-xl"} w-full min-w-0 rounded-xl border border-line bg-white text-center font-mono font-semibold text-ink outline-none transition focus:border-ink focus:ring-4 focus:ring-amber/25`}
                    aria-label={`Digit ${idx + 1} of ${expectedLength}`}
                  />
                ))}
              </div>

              <button
                type="button"
                onClick={() => handleVerifyOtp()}
                disabled={loading || otp.join("").length !== expectedLength}
                className="btn-yellow w-full py-3 text-sm disabled:opacity-50"
              >
                {loading ? <><LoaderCircle aria-hidden className="h-4 w-4 animate-spin" /> Verifying…</> : "Verify and continue"}
              </button>

              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-soft">
                {resendSeconds > 0 ? (
                  <span>Resend available in {resendSeconds}s</span>
                ) : (
                  <button
                    onClick={() => {
                      const pseudoForm = new FormData();
                      pseudoForm.set("email", email);
                      void handleSendOtp({ preventDefault: () => {}, currentTarget: pseudoForm as unknown as HTMLFormElement } as React.FormEvent<HTMLFormElement>);
                    }}
                    className="font-medium text-ink underline underline-offset-2 hover:text-brand"
                  >
                    Resend code
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    const newLen = expectedLength === 6 ? 8 : 6;
                    setExpectedLength(newLen);
                    setOtp(new Array(newLen).fill(""));
                  }}
                  className="underline underline-offset-2 hover:text-ink"
                >
                  {expectedLength === 6 ? "Have an 8-digit code?" : "Have a 6-digit code?"}
                </button>
              </div>
              <p className="text-xs text-ink-soft">Can&apos;t find it? Check your spam folder.</p>
            </div>
          )}

          {mode === "success" && (
            <div className="mt-6 h-1 overflow-hidden rounded-full bg-sand" aria-hidden>
              <div className="vsw-shimmer h-full w-full" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
