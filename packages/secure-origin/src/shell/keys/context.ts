// What the key pages read from the realm server, and how they word its
// refusals. The shapes themselves are `security/keys.ts`'s.
export type {
  DestinationDisplay,
  KeyShare,
  UserKey,
  WindowContext,
} from '../../security/keys.ts';

// What a refused request says to the user: the server's reason, as a
// sentence.
export function failureMessage(e: unknown): string {
  let message = (e as { message?: unknown })?.message;
  let text =
    typeof message === 'string' && message
      ? message
      : 'Something went wrong. Try again.';
  text = text.charAt(0).toUpperCase() + text.slice(1);
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

export interface LoadFailure {
  message: string;
  details: { label: string; value: string }[];
}

// What a page that couldn't load says went wrong: a general message, and in
// its details the response's status and the server's own account of it, or
// that no response came at all.
export function loadFailure(e: unknown): LoadFailure {
  let { status, code, message } = (e ?? {}) as {
    status?: unknown;
    code?: unknown;
    message?: unknown;
  };
  if (code === 'network') {
    return {
      message:
        'Boxel couldn’t be reached. Check your connection and try again.',
      details: [
        {
          label: 'Error',
          value:
            typeof message === 'string' && message
              ? message
              : 'No response from the server.',
        },
      ],
    };
  }
  return {
    message: 'Boxel couldn’t load this page.',
    details: [
      ...(typeof status === 'number' && status > 0
        ? [{ label: 'Status', value: String(status) }]
        : []),
      ...(typeof code === 'string' && code
        ? [{ label: 'Code', value: code }]
        : []),
      { label: 'Message', value: failureMessage(e) },
    ],
  };
}

export function isSignedOut(e: unknown): boolean {
  return (e as { code?: unknown })?.code === 'signed-out';
}
