"use client";

import { useState } from "react";
import { useStoreUi } from "../ui-store";
import { setMyAvatar, useNet } from "./net";
import type { AvatarKind } from "./rooms";

function CharacterIllustration({ kind, accent }: { kind: AvatarKind; accent: string }) {
  const skin = "#f1c9a5";
  const ink = "#14161c";
  if (kind === "woman") {
    return (
      <svg viewBox="0 0 120 140" className="h-32 w-28 drop-shadow-md" aria-hidden>
        {/* Chic hair bun & flowing back hair */}
        <circle cx="60" cy="18" r="11" fill="#3d2317" />
        <ellipse cx="60" cy="24" rx="10" ry="3" fill="#f5c451" />
        <path d="M37 42 C34 62 35 78 42 84 L78 84 C85 78 86 62 83 42 Z" fill="#3d2317" />
        {/* Head */}
        <circle cx="60" cy="44" r="19" fill={skin} />
        {/* Hair crown & side locks */}
        <path d="M40 42 C40 25 80 25 80 42 C74 33 46 33 40 42 Z" fill="#3d2317" />
        <path d="M41 42 C39 54 41 64 45 68 C46 58 46 48 45 42 Z" fill="#3d2317" />
        <path d="M79 42 C81 54 79 64 75 68 C74 58 74 48 75 42 Z" fill="#3d2317" />
        {/* Eyes, blush, smile & gold earrings */}
        <circle cx="53" cy="44" r="2.2" fill={ink} />
        <circle cx="67" cy="44" r="2.2" fill={ink} />
        <ellipse cx="48" cy="49" rx="3.5" ry="2" fill="#e58493" opacity="0.65" />
        <ellipse cx="72" cy="49" rx="3.5" ry="2" fill="#e58493" opacity="0.65" />
        <path d="M55 52 Q60 56 65 52" fill="none" stroke={ink} strokeWidth="2" strokeLinecap="round" />
        <circle cx="40" cy="48" r="2.5" fill="#f5c451" />
        <circle cx="80" cy="48" r="2.5" fill="#f5c451" />
        {/* Tailored blazer, collar & belt */}
        <path d="M42 66 L78 66 L74 102 L46 102 Z" fill={accent} />
        <path d="M51 66 L60 76 L69 66 Z" fill="#f7f4ec" />
        <rect x="46" y="96" width="28" height="5" rx="1.5" fill="#14161c" />
        <rect x="57" y="95.5" width="6" height="6" rx="1" fill="#f5c451" />
        {/* A-line skirt & legs */}
        <path d="M46 101 L74 101 L83 128 L37 128 Z" fill="#1e2432" />
        <rect x="49" y="128" width="7" height="10" rx="3" fill={skin} />
        <rect x="64" y="128" width="7" height="10" rx="3" fill={skin} />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 120 140" className="h-32 w-28 drop-shadow-md" aria-hidden>
      {/* Head & styled short hair */}
      <circle cx="60" cy="44" r="19" fill={skin} />
      <path d="M40 41 C40 22 80 22 80 41 C75 34 68 31 60 31 C52 31 45 34 40 41 Z" fill="#231b16" />
      <path d="M47 29 Q60 20 75 29 Q66 35 47 29 Z" fill="#231b16" />
      {/* Eyes & smile */}
      <circle cx="53" cy="44" r="2.2" fill={ink} />
      <circle cx="67" cy="44" r="2.2" fill={ink} />
      <path d="M55 52 Q60 56 65 52" fill="none" stroke={ink} strokeWidth="2" strokeLinecap="round" />
      {/* Tailored jacket & collar */}
      <path d="M38 66 L82 66 L79 104 L41 104 Z" fill={accent} />
      <path d="M50 66 L60 75 L70 66 Z" fill="#f7f4ec" />
      {/* Tailored trousers */}
      <path d="M41 104 L79 104 L77 136 L63 136 L60 116 L57 136 L43 136 Z" fill="#1e2432" />
    </svg>
  );
}

const OPTIONS: { id: AvatarKind; title: string; subtitle: string }[] = [
  { id: "woman", title: "Woman", subtitle: "Tailored blazer, A-line skirt & chic bun" },
  { id: "man", title: "Man", subtitle: "Tailored jacket, crisp collar & trousers" },
];

/** Shown right after entering the store (and reopenable from Pause) to choose Woman or Man avatar. */
export function AvatarPickerModal() {
  const open = useStoreUi((s) => s.avatarPickerOpen);
  const confirmChoice = useStoreUi((s) => s.confirmAvatarChoice);
  const requestLock = useStoreUi((s) => s.requestLock);
  const me = useNet((s) => s.me);
  const [selected, setSelected] = useState<AvatarKind>(me.avatar);

  if (!open) return null;

  const confirm = (choice: AvatarKind = selected) => {
    setMyAvatar(choice);
    confirmChoice();
    useStoreUi.getState().showToast(`Avatar set to ${choice === "woman" ? "Woman" : "Man"}`);
    requestLock();
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center overflow-y-auto bg-[#0d0f0e]/65 p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="avatar-picker-title"
    >
      <div className="w-full max-w-xl rounded-3xl bg-[#f7f6f1] p-6 text-[#0d0f0e] shadow-2xl ring-1 ring-black/10 sm:p-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#12392b]">Your 3D Shopper</p>
        <h2 id="avatar-picker-title" className="mt-1 font-display text-2xl font-bold tracking-tight sm:text-3xl">
          Choose your avatar
        </h2>
        <p className="mt-1.5 text-sm text-[#5b615d]">
          Pick how other shoppers see you in the store. You can switch anytime from the pause menu.
        </p>

        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {OPTIONS.map((opt) => {
            const active = selected === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => setSelected(opt.id)}
                onDoubleClick={() => confirm(opt.id)}
                aria-pressed={active}
                className={`group flex flex-col items-center rounded-2xl p-5 text-center transition ${
                  active
                    ? "bg-white shadow-lg ring-2 ring-[#12392b]"
                    : "bg-white/60 ring-1 ring-[#e2e0d6] hover:bg-white hover:ring-[#12392b]/40"
                }`}
              >
                <div className="flex h-36 w-full items-center justify-center rounded-xl bg-gradient-to-b from-[#ebe9df] to-[#f7f6f1]">
                  <CharacterIllustration kind={opt.id} accent={me.color} />
                </div>
                <span className="mt-3.5 text-base font-bold text-[#0d0f0e]">{opt.title}</span>
                <span className="mt-1 text-xs text-[#5b615d]">{opt.subtitle}</span>
                <span
                  className={`mt-3 inline-flex items-center rounded-full px-3 py-1 text-[11px] font-semibold ${
                    active ? "bg-[#12392b] text-[#f7f6f1]" : "bg-[#ebe9df] text-[#5b615d]"
                  }`}
                >
                  {active ? "Selected" : "Choose"}
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => confirm(selected)}
            className="w-full rounded-full bg-[#12392b] px-6 py-3.5 text-sm font-semibold text-[#f7f6f1] shadow-sm transition hover:bg-[#194c3a] sm:w-auto"
          >
            Start shopping as {selected === "woman" ? "Woman" : "Man"}
          </button>
        </div>
      </div>
    </div>
  );
}
