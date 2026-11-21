/** Start finding a room the moment the visitor clicks "enter", so it's settled by the time they land. */
export function startMatchmakingEarly(): void {
  import("./multiplayer/net").then((m) => { m.startMultiplayer(); m.unlockVoiceAudio(); }).catch(() => {});
}
