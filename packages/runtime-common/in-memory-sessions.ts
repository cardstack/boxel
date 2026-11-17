// The prerender server hands an automation run's tab its sessions in the
// page's memory, on this global, rather than in `localStorage['boxel-session']`:
// a run's token must stay out of anywhere the tab keeps state, such as storage
// or a cookie (ADR 026 §1.2). Every other render and command takes its
// sessions from that storage, and the prerender server deletes this global
// whenever it hands a tab sessions through storage, so a tab that serves a
// run and then something else never reads the run's sessions in place of its
// own.
//
// While the global is set, the host reads and writes the tab's sessions here
// and nowhere else, and drops them, with the realms that hold them, before
// the run answers.
export const inMemorySessionsGlobal = '__boxelInMemorySessions';

export function inMemorySessions(): Record<string, string> | undefined {
  let sessions = (globalThis as Record<string, unknown>)[
    inMemorySessionsGlobal
  ];
  return sessions && typeof sessions === 'object' && !Array.isArray(sessions)
    ? (sessions as Record<string, string>)
    : undefined;
}

export function clearInMemorySessions(): void {
  delete (globalThis as Record<string, unknown>)[inMemorySessionsGlobal];
}
