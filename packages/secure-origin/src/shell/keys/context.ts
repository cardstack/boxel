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

export function isSignedOut(e: unknown): boolean {
  return (e as { code?: unknown })?.code === 'signed-out';
}

// Whether a request was refused because what it names doesn't exist, or isn't
// the user's to see, which the realm server answers alike. Anything else that
// stops a page loading (the server can't be reached, or fails) is worth trying
// again.
export function isNotFound(e: unknown): boolean {
  return (e as { status?: unknown })?.status === 404;
}
