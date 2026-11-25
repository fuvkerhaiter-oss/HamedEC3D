"use client";

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
      setOtp((prev) => (prev.length === expectedLength ? prev : new Array(expectedLength).fill("")));
      setError(null);
      setResendSeconds(60);
      setTimeout(() => otpInputRefs.current[0]?.focus(), 50);
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

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
    >
      {/* Backdrop */}
      <div
        className="vsw-fade-in absolute inset-0 bg-ink/60 backdrop-blur-sm"
        onClick={closeAuth}
        aria-hidden="true"
      />

      {/* Modal Container */}
      <div
        className="vsw-cart-pop relative w-full max-w-md overflow-hidden rounded-[2.5rem] bg-cream shadow-[-10px_20px_50px_rgb(0_0_0/0.3)] ring-4 ring-amber"
        style={{ maxHeight: "calc(100dvh - 2rem)" }}
      >
        {/* Receipt Header Banner */}
        <header className="relative flex items-center justify-between overflow-hidden bg-amber px-6 py-5 text-ink">
          <span aria-hidden className="pointer-events-none absolute -right-6 -top-8 h-24 w-24 rounded-full bg-white/20" />
          <div className="flex items-center gap-3">
            <span className="vsw-cart-bob grid h-10 w-10 place-items-center rounded-2xl bg-white text-2xl shadow-sm">
              🛒
            </span>
            <div>
              <h2 id="auth-modal-title" className="font-display text-2xl font-extrabold leading-none tracking-tight">
                WEGO SHIIIP
              </h2>
              <p className="mt-0.5 text-xs font-semibold text-ink/75">
                {mode === "welcome" && "Welcome to the aisles!"}
                {mode === "signin" && "Welcome back!"}
                {mode === "signup" && "Unlock your shopping identity"}
                {mode === "otp" && "Verification Station"}
                {mode === "success" && "VIP Passport Issued"}
              </p>
            </div>
          </div>

          <button
            onClick={closeAuth}
            className="grid h-8 w-8 place-items-center rounded-full bg-ink text-lg font-bold text-amber transition hover:scale-110 active:scale-95"
            aria-label="Close authentication dialog"
          >
            ×
          </button>
        </header>

        {/* Content Area */}
        <div className="overflow-y-auto p-6 sm:p-7">
          {error && (
            <div className="mb-5 rounded-2xl bg-red-100/80 p-3.5 text-xs font-medium text-red-900 ring-1 ring-red-300">
              ⚠️ {error}
            </div>
          )}

          {/* MODE: WELCOME */}
          {mode === "welcome" && (
            <div className="space-y-4">
              <div className="text-center pb-2">
                <span className="inline-block rounded-full bg-sand px-3 py-1 text-xs font-bold text-ink">
                  WHO ARE YOU TODAY?
                </span>
                <p className="mt-2 text-sm text-ink-soft">
                  Choose how you want to experience the supermarket today.
                </p>
              </div>

              {/* Continue as Guest */}
              <button
                onClick={closeAuth}
                className="group flex w-full items-center justify-between rounded-2xl bg-white p-4 shadow-sm ring-1 ring-line transition hover:-translate-y-0.5 hover:ring-amber hover:shadow-md"
              >
                <div className="text-left">
                  <span className="font-display font-bold text-ink text-base block group-hover:text-amber-800">
                    Continue as Guest
                  </span>
                  <span className="text-xs text-ink-soft block mt-0.5">
                    No paperwork. No commitment. Just your trolley and the shelves.
                  </span>
                </div>
                <span className="text-2xl transition group-hover:translate-x-1">🛒</span>
              </button>

              {/* Sign In */}
              <button
                onClick={() => { setError(null); setMode("signin"); }}
                className="group flex w-full items-center justify-between rounded-2xl bg-white p-4 shadow-sm ring-1 ring-line transition hover:-translate-y-0.5 hover:ring-amber hover:shadow-md"
              >
                <div className="text-left">
                  <span className="font-display font-bold text-ink text-base block group-hover:text-amber-800">
                    Sign In
                  </span>
                  <span className="text-xs text-ink-soft block mt-0.5">
                    You are back! We kept your favorite snacks nicely stocked.
                  </span>
                </div>
                <span className="text-2xl transition group-hover:translate-x-1">🔑</span>
              </button>

              {/* Create Account */}
              <button
                onClick={() => { setError(null); setMode("signup"); }}
                className="group flex w-full items-center justify-between rounded-2xl bg-white p-4 shadow-sm ring-1 ring-line transition hover:-translate-y-0.5 hover:ring-amber hover:shadow-md"
              >
                <div className="text-left">
                  <span className="font-display font-bold text-ink text-base block group-hover:text-amber-800">
                    Create Account
                  </span>
                  <span className="text-xs text-ink-soft block mt-0.5">
                    Unlock your VIP shopping pass. Your cart has feelings too.
                  </span>
                </div>
                <span className="text-2xl transition group-hover:translate-x-1">✨</span>
              </button>

              {/* Google OAuth Option */}
              <div className="pt-2 border-t border-line">
                <button
                  onClick={handleGoogleClick}
                  disabled={loading}
                  className="flex w-full items-center justify-center gap-3 rounded-full border border-line bg-white py-3 px-4 text-sm font-semibold text-ink shadow-sm transition hover:bg-sand active:scale-[0.98] disabled:opacity-60"
                >
                  <GoogleIcon />
                  Continue with Google
                </button>
              </div>
            </div>
          )}

          {/* MODE: SIGN IN / SIGN UP */}
          {(mode === "signin" || mode === "signup") && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setMode("welcome")}
                  className="text-xs font-semibold text-ink-soft hover:text-ink"
                >
                  ← Back to options
                </button>
                <span className="text-xs font-mono text-ink-soft">
                  {mode === "signin" ? "Returning Shopper" : "New Shopper"}
                </span>
              </div>

              <div className="text-center pb-1">
                <h3 className="font-display text-2xl font-extrabold text-ink">
                  {mode === "signin" ? "Sign in to your trolley" : "Create your shopping pass"}
                </h3>
                <p className="mt-1 text-xs text-ink-soft">
                  Passwordless authentication with a one-time verification code.
                </p>
              </div>

              {/* Google Button */}
              <button
                onClick={handleGoogleClick}
                disabled={loading}
                className="flex w-full items-center justify-center gap-3 rounded-full border border-line bg-white py-3 px-4 text-sm font-semibold text-ink shadow-sm transition hover:bg-sand active:scale-[0.98] disabled:opacity-60"
              >
                <GoogleIcon />
                Continue with Google
              </button>

              <div className="relative my-4 text-center">
                <span className="absolute inset-x-0 top-1/2 -translate-y-1/2 border-t border-line" />
                <span className="relative bg-cream px-3 text-xs font-mono text-ink-soft">
                  OR WITH EMAIL
                </span>
              </div>

              {/* Email Form */}
              <form onSubmit={handleSendOtp} className="space-y-3">
                <div>
                  <label htmlFor="auth-email-input" className="block text-xs font-bold text-ink mb-1">
                    Your Email Address
                  </label>
                  <input
                    id="auth-email-input"
                    name="email"
                    type="email"
                    required
                    autoFocus
                    placeholder="e.g. snack.master@gmail.com"
                    defaultValue={email}
                    className="w-full rounded-2xl border border-line bg-white px-4 py-3 text-sm text-ink outline-none transition focus:border-ink focus:ring-2 focus:ring-amber/40"
                  />
                  <span className="mt-1 block text-[11px] text-ink-soft">
                    One tiny verification code. Zero suspicious vegetables.
                  </span>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-full bg-amber py-3.5 font-bold text-ink shadow-[0_4px_0_var(--color-ink)] transition hover:-translate-y-0.5 active:translate-y-0.5 active:shadow-none disabled:opacity-60"
                >
                  {loading ? "Sending code…" : "Send Verification Code 📨"}
                </button>
              </form>

              <div className="pt-2 text-center">
                <button
                  onClick={closeAuth}
                  className="text-xs text-ink-soft underline decoration-dashed hover:text-ink"
                >
                  Never mind, I'll shop as a guest for now
                </button>
              </div>
            </div>
          )}

          {/* MODE: OTP */}
          {mode === "otp" && (
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setMode("signin")}
                  className="text-xs font-semibold text-ink-soft hover:text-ink"
                >
                  ← Wrong email?
                </button>
                <span className="text-xs font-mono text-ink-soft">Step 2 of 2</span>
              </div>

              <div className="text-center">
                <span className="text-3xl">📬</span>
                <h3 className="mt-2 font-display text-2xl font-extrabold text-ink">
                  WE SENT A LITTLE SECRET
                </h3>
                <p className="mt-1 text-xs text-ink-soft leading-relaxed">
                  We sent a {expectedLength}-digit verification code to <b className="text-ink font-mono">{email}</b>.
                  Check your inbox. If it is hiding, check the spam aisle!
                </p>
              </div>

              {/* Digit Input (supports 6 or 8 digits) */}
              <div className="flex justify-center gap-1.5 sm:gap-2" onPaste={handleOtpPaste}>
                {otp.map((digit, idx) => (
                  <input
                    key={idx}
                    ref={(el) => { otpInputRefs.current[idx] = el; }}
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleOtpChange(idx, e.target.value)}
                    onKeyDown={(e) => handleOtpKeyDown(idx, e)}
                    className={
                      expectedLength === 8
                        ? "h-11 w-8 sm:h-13 sm:w-10 rounded-xl sm:rounded-2xl border-2 border-line bg-white text-center font-mono text-lg sm:text-xl font-bold text-ink outline-none transition focus:border-amber focus:ring-4 focus:ring-amber/20"
                        : "h-12 w-11 sm:h-14 sm:w-12 rounded-2xl border-2 border-line bg-white text-center font-mono text-xl sm:text-2xl font-bold text-ink outline-none transition focus:border-amber focus:ring-4 focus:ring-amber/20"
                    }
                    aria-label={`Digit ${idx + 1}`}
                  />
                ))}
              </div>

              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={() => {
                    const newLen = expectedLength === 6 ? 8 : 6;
                    setExpectedLength(newLen);
                    setOtp(new Array(newLen).fill(""));
                  }}
                  className="text-[11px] text-ink-soft hover:text-ink underline decoration-dotted"
                >
                  {expectedLength === 6 ? "Got an 8-digit code instead?" : "Got a 6-digit code instead?"}
                </button>
              </div>

              <button
                type="button"
                onClick={() => handleVerifyOtp()}
                disabled={loading || otp.join("").length !== expectedLength}
                className="flex w-full items-center justify-center gap-2 rounded-full bg-amber py-3.5 font-bold text-ink shadow-[0_4px_0_var(--color-ink)] transition hover:-translate-y-0.5 active:translate-y-0.5 active:shadow-none disabled:opacity-50"
              >
                {loading ? "Verifying…" : "Verify & Enter Supermarket 🛒"}
              </button>

              {/* Resend section */}
              <div className="text-center text-xs text-ink-soft">
                {resendSeconds > 0 ? (
                  <span>Resend code available in {resendSeconds}s</span>
                ) : (
                  <button
                    onClick={() => {
                      const pseudoForm = new FormData();
                      pseudoForm.set("email", email);
                      void handleSendOtp({ preventDefault: () => {}, currentTarget: pseudoForm as unknown as HTMLFormElement } as React.FormEvent<HTMLFormElement>);
                    }}
                    className="font-semibold text-ink underline hover:text-amber-800"
                  >
                    Didn't receive it? Resend code now
                  </button>
                )}
              </div>
            </div>
          )}

          {/* MODE: SUCCESS */}
          {mode === "success" && (
            <div className="py-8 text-center space-y-3">
              <span className="vsw-cart-bob inline-block text-6xl">🎉</span>
              <h3 className="font-display text-2xl font-extrabold text-ink">
                SHOPPING IDENTITY VERIFIED!
              </h3>
              <p className="text-sm text-ink-soft">
                Your trolley has been granted VIP status. Merging your snacks and syncing shelves…
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
