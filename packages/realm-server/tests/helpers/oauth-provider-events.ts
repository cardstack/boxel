import type { CapturedLogLine } from './log-capture.ts';

// The sentence a `boxel:oauth-provider` line gives an operator: an event
// line's `message`, or a plain line as it is.
export function readableMessage(message: string): string {
  let event = parseEvent(message);
  return typeof event?.message === 'string' ? event.message : message;
}

// The provider's event lines among `lines`, parsed.
export function oauthEvents(
  lines: CapturedLogLine[],
): Record<string, unknown>[] {
  return lines
    .filter(({ channel }) => channel === 'boxel:oauth-provider')
    .map(({ message }) => parseEvent(message))
    .filter((event): event is Record<string, unknown> => event !== undefined);
}

function parseEvent(message: string): Record<string, unknown> | undefined {
  if (!message.startsWith('{')) {
    return undefined;
  }
  try {
    let parsed = JSON.parse(message);
    return parsed?.channel === 'boxel:oauth-provider' ? parsed : undefined;
  } catch {
    return undefined;
  }
}
