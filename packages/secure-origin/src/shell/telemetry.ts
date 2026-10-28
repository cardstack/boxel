// The shell's telemetry instrument (`../telemetry/instrument.ts`). `shell.js`
// starts it as the document loads; the router reports each page opened and
// rendered (`app.gts`), and a page that loads data reports how its load ended
// through its visit (`pageAwaitsData`).
// Until it starts every report is dropped, so a component test that renders a
// page without the shell sends nothing.
import { readConfig, storedSession } from '../security/session.js';
import { SecureTelemetry, type PageVisit } from '../telemetry/instrument.ts';

let instrument: SecureTelemetry | undefined;

export function startTelemetry(
  deps: Partial<ConstructorParameters<typeof SecureTelemetry>[0]> = {},
): SecureTelemetry | undefined {
  if (instrument) {
    return instrument;
  }
  try {
    instrument = new SecureTelemetry({
      window,
      serverURL: readConfig().realmServerURL,
      session: storedSession,
      ...deps,
    });
    instrument.start();
  } catch {
    // A page without telemetry still works.
    instrument = undefined;
  }
  return instrument;
}

export function stopTelemetry(): void {
  instrument?.stop();
  instrument = undefined;
}

// Sends what is buffered now, before the window closes.
export function flushTelemetry(reason: string): void {
  instrument?.flushAll(reason);
}

export function pageOpened(routeName: string | undefined): void {
  instrument?.pageOpened(routeName);
}

export function pageRendered(): void {
  instrument?.pageRendered();
}

// For a page that loads data, called while it renders: the visit it reports
// how its load ended through.
export function pageAwaitsData(): PageVisit {
  return (
    instrument?.pageAwaitsData() ?? {
      loaded() {},
      loadFailed() {},
      signedOut() {},
    }
  );
}
