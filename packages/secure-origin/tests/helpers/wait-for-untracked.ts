import { waitUntil } from '@ember/test-helpers';

// `settled()` waits for the work Ember tracks: rendering, the run loop and
// test waiters. A page's stubbed `fetch` promises, `File.text()`, a frame's
// messages and other browser promises are invisible to it, so a test waits
// instead for what that work brings about. On a timeout the failure names
// what never happened and, from `progress`, how far the page got, so every
// race in the suite fails with the same shape of message.
export async function waitForUntracked(
  condition: () => unknown,
  {
    waitingFor,
    progress,
    timeout,
  }: {
    // What the test is waiting for, as a phrase: "the window to go somewhere".
    waitingFor: string;
    // The state worth reading when it never happens: the requests made by
    // then, an error the page shows.
    progress?: () => string;
    timeout?: number;
  },
): Promise<void> {
  // An error the condition throws is the test's own failure, reported as it
  // is; only a timeout gets the diagnostics.
  let thrown: { error: unknown } | undefined;
  try {
    await waitUntil(
      () => {
        try {
          return condition();
        } catch (error) {
          thrown = { error };
          throw error;
        }
      },
      timeout === undefined ? {} : { timeout },
    );
  } catch (error) {
    if (thrown) {
      throw thrown.error;
    }
    let state = progress?.();
    throw new Error(
      `timed out waiting for ${waitingFor}${state ? `; ${state}` : ''}`,
      { cause: error },
    );
  }
}

// How a module's `progress` describes the requests a page made.
export function requestsMade(requests: { method: string; path: string }[]) {
  let made = requests.map((r) => `${r.method} ${r.path}`).join(', ');
  return `requests made: ${made || 'none'}`;
}

// How a module's `progress` describes an error the page shows.
export function errorShown(selector: string) {
  let shown = document.querySelector(selector)?.textContent?.trim();
  return `error shown: ${shown || 'none'}`;
}
