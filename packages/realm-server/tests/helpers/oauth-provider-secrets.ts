import { logLinesDuring, withLogDefinition } from './log-capture.ts';
import { startSentryCapture, type SentryEvent } from './sentry-capture.ts';

// Everything the realm server's telemetry recorded while `fn` ran: the lines
// logged on the request log and the provider's channel (and any other
// `channels`), and every Sentry envelope, transactions included, so each
// request's URL and spans are there to search. Start the server before
// calling this: the capture records requests it is already listening for.
//
// The OAuth provider's tests drive an endpoint with known values (a token, a
// code, an interaction ID, an error reference) and check that none of them is
// in what this returns (`assertNoSecrets`), as ADR 021 §1.2 and spec §14 ask.
export interface CapturedTelemetry {
  logs: string;
  sentry: string;
  transactions: SentryEvent[];
}

const DEFAULT_CHANNELS = ['realm:requests', 'boxel:oauth-provider'];

export async function telemetryDuring(
  fn: () => Promise<void>,
  { channels = [] }: { channels?: string[] } = {},
): Promise<CapturedTelemetry> {
  let sentry = startSentryCapture({ tracing: true, incomingRequests: true });
  try {
    let lines = await withLogDefinition('realm:requests', 'info', () =>
      logLinesDuring([...DEFAULT_CHANNELS, ...channels], async () => {
        await fn();
      }),
    );
    let sent = await sentry.flushed();
    let transactions = await sentry.flushedTransactions();
    return {
      logs: lines.map(({ message }) => message).join('\n'),
      sentry: sent,
      transactions,
    };
  } finally {
    await sentry.stop();
  }
}

// Asserts no secret appears in the logs or in anything sent to Sentry, in
// any of the forms a URL may carry it.
export function assertNoSecrets(
  assert: Assert,
  telemetry: CapturedTelemetry,
  secrets: Record<string, string>,
) {
  for (let [name, value] of Object.entries(secrets)) {
    for (let form of new Set([value, encodeURIComponent(value)])) {
      assert.false(
        telemetry.logs.includes(form),
        `no log line carries the ${name}`,
      );
      assert.false(
        telemetry.sentry.includes(form),
        `nothing sent to Sentry carries the ${name}`,
      );
    }
  }
}
