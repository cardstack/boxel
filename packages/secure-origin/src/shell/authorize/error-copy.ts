// What the authorize page's error page says in each of its states. Every
// word is fixed here. The only thing the server tells the page that it shows
// is the app's name, and a state words itself with "the app" when it has
// none.

import type { ErrorApp, ErrorState } from '../../security/oauth-errors.ts';

export type ErrorPageState = ErrorState | 'load-failed';

export interface ErrorCopy {
  heading: string;
  info: string;
}

// An app's name at the start of a sentence. A domain or a client's own name
// is written as it is; the phrase standing in for an app on the user's
// computer starts with a capital.
function sentenceStart(app: ErrorApp): string {
  return app.onThisComputer
    ? app.shown[0]!.toUpperCase() + app.shown.slice(1)
    : app.shown;
}

export function errorCopy(
  state: ErrorPageState,
  { app, retryable = false }: { app?: ErrorApp; retryable?: boolean } = {},
): ErrorCopy {
  let subject = app ? sentenceStart(app) : 'The app';
  let from = app ? app.shown : 'the app';
  switch (state) {
    case 'invalid-client':
      return {
        heading: 'This app can’t connect',
        info: 'The app’s registration is missing or invalid. Ask the app’s maker to set it up again.',
      };
    case 'bad-redirect':
      return {
        heading: 'This link doesn’t match the app',
        info: `${subject} asked to return to an address it didn’t register. For your safety, Boxel won’t send you there.`,
      };
    case 'expired':
      return {
        heading: 'This request has expired',
        info: `Start connecting again from ${from}.`,
      };
    case 'not-offered':
      return {
        heading: 'Boxel doesn’t offer that',
        info: `${subject} asked for access Boxel doesn’t have. Nothing was shared.`,
      };
    case 'not-allowed':
      return {
        heading: 'This app can’t connect here',
        info: app
          ? `${subject} isn’t allowed to access Boxel workspaces. Nothing was shared.`
          : 'This app isn’t allowed to access Boxel workspaces. Nothing was shared.',
      };
    case 'unsupported':
      return {
        heading: 'This app’s request isn’t supported',
        info: `${subject} asked to connect in a way Boxel doesn’t support. Nothing was shared.`,
      };
    case 'cant-continue':
      return {
        heading: 'This request can’t continue',
        info: `Nothing was shared. Start connecting again from ${from}.`,
      };
    case 'answered':
      return {
        heading: 'This request was already answered',
        info: 'It was answered in another window. There’s nothing more to do here.',
      };
    case 'rate-limited':
      return {
        heading: 'Too many attempts',
        info: `Wait a few minutes, then start connecting again from ${from}.`,
      };
    case 'load-failed':
      return {
        heading: 'This page couldn’t load',
        info: retryable
          ? 'Boxel couldn’t be reached. Check your connection, then try again.'
          : `Start connecting again from ${from}.`,
      };
  }
}

// The label of the link back to the app.
export function returnLabel(app: ErrorApp): string {
  return `Return to ${app.shown}`;
}

// Shown after Close when the window stays open: a window the app opened, or
// that the user opened, can't be closed by script.
export const CLOSE_HINT = 'You can close this window.';
