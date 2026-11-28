"use client";

import { useEffect, useRef, useState } from "react";
import { TOUCH_PAUSE_LEFT } from "../hud/TouchControls";
import { useStoreUi } from "../ui-store";
import { EMOTES } from "./emotes";
import { EmoteWheel } from "./EmoteWheel";
import { ROOM_CAPACITY } from "./rooms";
import { acceptVoiceNotice, declineVoiceNotice, setAllMuted, setMyName, setPeerMuted, startMultiplayer, stopMultiplayer, toggleMic, triggerEmote, useNet } from "./net";

function MicIcon({ off }: { off: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0M12 17v5" />
      {off && <path d="M3 3l18 18" />}
    </svg>
  );
}

/** Room badge (top-left): who's here, mic toggle (V), my display name. Also owns the connection lifecycle. */
export function RoomHud() {
  const { status, message, room, me, members, micOn, micError, local, muted, voiceConsentNeeded } = useNet();
  const locked = useStoreUi((s) => s.locked);
  const inspect = useStoreUi((s) => s.inspect);
  const touchMode = useStoreUi((s) => s.touchMode);
  const [draft, setDraft] = useState<string | null>(null);
  const known = useRef<Set<string> | null>(null);

  useEffect(() => {
    startMultiplayer();
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.repeat || t?.closest("input, textarea")) return;
      if (e.code === "KeyV") {
        void toggleMic();
        return;
      }
      if (useStoreUi.getState().stage !== "play" || useStoreUi.getState().inspect) return;
      const em = EMOTES.find((x) => e.code === `Digit${x.key}` || e.code === `Numpad${x.key}`);
      if (em) {
        triggerEmote(em.id);
        if (useNet.getState().myEmote === em.id) {
          useStoreUi.getState().showToast(`${em.emoji} ${em.label}!`);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pagehide", stopMultiplayer); // leave the room at once on tab close
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pagehide", stopMultiplayer);
      stopMultiplayer();
    };
  }, []);

  // "X joined / left" toasts (not for the people already in the room when I arrive).
  useEffect(() => {
    const ids = new Set(members.map((m) => m.id));
    const prev = known.current;
    known.current = status === "online" ? ids : null;
    if (!prev) return;
    const joined = members.find((m) => !prev.has(m.id));
    if (joined) useStoreUi.getState().showToast(`👋 ${joined.name} walked into the store`);
  }, [members, status]);

  if (inspect || status === "off") return null;
  const count = members.length + 1;

  return (
    <div
      className="fixed z-30 flex max-w-[min(18rem,calc(100vw-2rem))] flex-col gap-2 text-cream"
      // Touch play: the Pause button owns the top-left corner (14px + 44px), so sit just right of it.
      style={{ left: `calc(env(safe-area-inset-left, 0px) + ${touchMode && locked ? `${TOUCH_PAUSE_LEFT} + 54px` : "1rem"})`, top: "calc(env(safe-area-inset-top, 0px) + 1rem)" }}
    >
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 rounded-full bg-ink/70 px-3.5 py-2 text-xs shadow-lg ring-1 ring-cream/20 backdrop-blur" role="status" title={message ?? undefined}>
          <span className={`h-2 w-2 rounded-full ${status === "online" ? "bg-emerald-400" : status === "connecting" ? "animate-pulse bg-amber" : "bg-cream/40"}`} />
          {status === "online" && <span><b className="font-semibold">{local ? "Local test room" : `Room ${room}`}</b> · {count}/{ROOM_CAPACITY} shoppers</span>}
          {status === "connecting" && <span>Finding your room…</span>}
          {status === "unavailable" && <span>Solo shopping</span>}
        </div>
        {status === "online" && (
          <button
            type="button"
            onClick={() => void toggleMic()}
            aria-pressed={micOn}
            aria-label={micOn ? "Mute microphone" : "Open microphone to talk"}
            title={micOn ? "Mic on (V)" : "Mic off (V)"}
            className={`flex h-9 w-9 items-center justify-center rounded-full shadow-lg ring-1 backdrop-blur transition ${micOn ? "bg-emerald-500 text-ink ring-emerald-300" : "bg-ink/70 ring-cream/20 hover:bg-ink"}`}
          >
            <MicIcon off={!micOn} />
          </button>
        )}
      </div>

      {voiceConsentNeeded && (
        <div role="dialog" aria-modal="false" aria-labelledby="voice-notice-title" className="rounded-2xl bg-cream p-4 text-xs text-ink shadow-xl ring-1 ring-ink/10">
          <p id="voice-notice-title" className="font-display text-sm font-bold">Before you talk</p>
          <ul className="mt-2 list-disc space-y-1 pl-4">
            <li>Other shoppers in this room (strangers) will hear you. Nothing is recorded by us.</li>
            <li>Voice connects you directly to them, so they can see your internet (IP) address.</li>
            <li>Don&apos;t share personal details. Voice is for adults (16+); children should shop with a parent.</li>
            <li>You can mute anyone, mute everyone, or leave the room at any time.</li>
          </ul>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => void acceptVoiceNotice()} className="rounded-full bg-ink px-3 py-1.5 font-semibold text-cream">I understand, turn on my mic</button>
            <button type="button" onClick={declineVoiceNotice} className="rounded-full px-3 py-1.5 font-semibold ring-1 ring-ink/20">Not now</button>
          </div>
        </div>
      )}

      {micError && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-800">{micError}</p>}

      {!locked && status === "online" && (
        <div className="rounded-2xl bg-ink/70 p-3 text-xs shadow-lg ring-1 ring-cream/20 backdrop-blur max-sm:hidden short:hidden">
          <label className="flex items-center gap-2">
            <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: me.color }} />
            <input
              value={draft ?? me.name}
              maxLength={20}
              aria-label="Your name in the store"
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => { if (draft !== null) setMyName(draft); setDraft(null); }}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              className="w-full rounded-md bg-cream/10 px-2 py-1 text-cream outline-none focus:ring-1 focus:ring-amber"
            />
            <span className="shrink-0 text-cream/60">you</span>
          </label>
          {members.length > 0 ? (
            <ul className="mt-2 space-y-1">
              {members.map((m) => (
                <li key={m.id} className="flex items-center gap-2">
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: m.color }} />
                  <span className="truncate">{m.name}</span>
                  <span className="ml-auto flex shrink-0 items-center gap-1.5">
                    {m.mic && !muted.includes(m.id) && <span className="text-emerald-300"><MicIcon off={false} /></span>}
                    <button
                      type="button"
                      onClick={() => setPeerMuted(m.id, !muted.includes(m.id))}
                      aria-pressed={muted.includes(m.id)}
                      aria-label={muted.includes(m.id) ? `Unmute ${m.name}` : `Mute ${m.name} for me`}
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 transition ${muted.includes(m.id) ? "bg-red-500/80 text-cream ring-red-300" : "text-cream/80 ring-cream/30 hover:bg-cream/10"}`}
                    >
                      {muted.includes(m.id) ? "Muted" : "Mute"}
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-cream/60">You&apos;re first here. Others joining now land in your room.</p>
          )}
          <div className="mt-3 flex flex-wrap gap-1.5 border-t border-cream/15 pt-2">
            {members.length > 0 && (
              <button type="button" onClick={() => setAllMuted(muted.length < members.length)} className="rounded-full px-2 py-0.5 text-[11px] font-medium text-cream/80 ring-1 ring-cream/30 hover:bg-cream/10">
                {muted.length < members.length ? "Mute everyone" : "Unmute everyone"}
              </button>
            )}
            <button type="button" onClick={stopMultiplayer} className="rounded-full px-2 py-0.5 text-[11px] font-medium text-cream/80 ring-1 ring-cream/30 hover:bg-cream/10">Leave room (shop alone)</button>
            <a href="/contact" target="_blank" rel="noopener" className="rounded-full px-2 py-0.5 text-[11px] font-medium text-cream/80 ring-1 ring-cream/30 hover:bg-cream/10">Report a problem</a>
          </div>
        </div>
      )}

      {/* Single Emote button that opens a radial circle wheel */}
      <EmoteWheel />
    </div>
  );
}
