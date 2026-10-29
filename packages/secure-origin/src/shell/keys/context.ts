// What the key pages read from the realm server, and how they word its
// refusals. The shapes themselves are `security/keys.ts`'s.
export type {
  ConnectableClient,
  DestinationDisplay,
  KeyShare,
  ListedKey,
  OAuthClientRef,
  OAuthKeyDescription,
  SharedWorkspace,
  SlotBound,
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
  // Whether trying again could go differently: not for a page whose link
  // names nothing it can show, nor for a request the server refused as it
  // was asked.
  retryable: boolean;
}

// A page's link names nothing the page can show: no key or workspace at all,
// or one the user doesn't have. `message` is the detail; `userMessage` is what
// the page says, naming what the link asked for.
export class LinkError extends Error {
  userMessage: string;
  constructor(message: string, userMessage: string) {
    super(message);
    this.userMessage = userMessage;
  }
}

const NOT_FOUND =
  'This workspace, card or request doesn’t exist, or you don’t have access to it.';

// A refusal for the request itself (4xx) stands however often it's asked,
// except a timeout or too many requests.
function retryableStatus(status: unknown): boolean {
  return (
    typeof status !== 'number' ||
    status < 400 ||
    status >= 500 ||
    status === 408 ||
    status === 429
  );
}

function generalMessage(e: unknown, status: unknown): string {
  // The server answers 404 for what the user can't read as well as for what
  // isn't there, so the message can't tell which.
  if (e instanceof LinkError) {
    return e.userMessage;
  }
  if (status === 404) {
    return NOT_FOUND;
  }
  if (status === 403) {
    return 'You don’t have access to this.';
  }
  return 'Boxel couldn’t load this page.';
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
      retryable: true,
    };
  }
  return {
    message: generalMessage(e, status),
    retryable: !(e instanceof LinkError) && retryableStatus(status),
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

// What a request with this HTTP method does at its destination, for someone
// who doesn't read HTTP.
export function methodPhrase(method: string): string {
  switch (method.toUpperCase()) {
    case 'GET':
    case 'HEAD':
      return 'Reads from';
    case 'DELETE':
      return 'Deletes at';
    default:
      return 'Sends data to';
  }
}

// The permissions an OAuth client asks for, one per scope. Scopes are
// separated by spaces, and by commas for a service that writes them so.
export function scopesOf(scopes: string | null | undefined): string[] {
  return (scopes ?? '').split(/[\s,]+/).filter(Boolean);
}
