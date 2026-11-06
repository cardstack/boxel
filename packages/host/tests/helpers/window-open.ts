export type WindowOpenCall = {
  url: string;
  target?: string;
  features?: string;
};

// Records each `open` on `win` and answers it with a stand-in window, or with
// null while `state.blocked` is set, as a browser that blocks the popup does.
// `restore` puts the original `open` back. A stub on ember-window-mock's
// `window` reaches only code that imports the mock, and setupWindowMock resets
// it after each test. A stub on the global `window` also reaches code that
// calls the global `window.open` directly, and lasts until `restore`.
export function stubWindowOpen(win: Pick<Window, 'open'> = window) {
  let original = win.open;
  let calls: WindowOpenCall[] = [];
  let popups: { opener: unknown }[] = [];
  let state = { blocked: false };
  win.open = ((url?: string | URL, target?: string, features?: string) => {
    calls.push({ url: String(url), target, features });
    if (state.blocked) {
      return null;
    }
    let popup = { opener: win as unknown };
    popups.push(popup);
    return popup;
  }) as typeof window.open;
  return {
    calls,
    popups,
    state,
    restore() {
      win.open = original;
    },
  };
}
