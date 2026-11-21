/**
 * DEV-ONLY stand-in for a Supabase Realtime channel when NEXT_PUBLIC_SUPABASE_* aren't set: presence and
 * broadcast between tabs of THIS browser (BroadcastChannel). Lets rooms/avatars/voice be tested locally;
 * never used in production builds. The HUD labels it "local test room".
 */
import type { Chan } from "./net";

type Msg = { t: "p"; key: string; meta: Record<string, unknown>; hello?: boolean } | { t: "bye"; key: string } | { t: "b"; event: string; payload: unknown };

export function localChannel(name: string, key: string): Chan {
  const bc = new BroadcastChannel(name);
  const peers = new Map<string, { meta: Record<string, unknown>; seen: number }>();
  const syncFns: (() => void)[] = [];
  const bFns = new Map<string, ((m: { payload: unknown }) => void)[]>();
  let me: Record<string, unknown> | null = null;
  const sync = () => syncFns.forEach((f) => f());
  const beat = (hello = false) => me && bc.postMessage({ t: "p", key, meta: me, hello } satisfies Msg);
  const timer = setInterval(() => {
    beat();
    let changed = false;
    for (const [k, v] of peers) if (performance.now() - v.seen > 3500) { peers.delete(k); changed = true; }
    if (changed) sync();
  }, 1000);

  bc.onmessage = (e: MessageEvent<Msg>) => {
    const m = e.data;
    if (m.t === "b") return bFns.get(m.event)?.forEach((f) => f({ payload: m.payload }));
    if (m.t === "bye") { if (peers.delete(m.key)) sync(); return; }
    const known = peers.get(m.key);
    peers.set(m.key, { meta: m.meta, seen: performance.now() });
    if (m.hello) beat();
    if (!known || JSON.stringify(known.meta) !== JSON.stringify(m.meta)) sync();
  };

  const chan: Chan = {
    on(type, filter, cb) {
      if (type === "presence") syncFns.push(cb as () => void);
      else bFns.set(filter.event, [...(bFns.get(filter.event) ?? []), cb as (m: { payload: unknown }) => void]);
      return chan;
    },
    subscribe(cb) {
      setTimeout(() => cb("SUBSCRIBED"), 0);
      return chan;
    },
    track(meta) {
      me = meta;
      beat(true);
      setTimeout(sync, 0);
      return Promise.resolve("ok");
    },
    presenceState() {
      const all: Record<string, Record<string, unknown>[]> = {};
      for (const [k, v] of peers) all[k] = [v.meta];
      if (me) all[key] = [me];
      return all;
    },
    send({ event, payload }) {
      bc.postMessage({ t: "b", event, payload } satisfies Msg);
      return Promise.resolve("ok");
    },
    remove() {
      clearInterval(timer);
      bc.postMessage({ t: "bye", key } satisfies Msg);
      bc.close();
    },
  };
  return chan;
}
