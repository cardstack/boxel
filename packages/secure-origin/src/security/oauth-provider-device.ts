// What the `device` page asks of Boxel's OAuth provider (ADR 021 §1.7): an
// app on a computer with no browser, such as boxel-cli over SSH, showed the
// user a code, and the user types it here. The page looks the code up, under
// the window's own session, and gets the same consent as the authorize page;
// then it sends the user's answer. The app learns the answer from the
// provider when it next polls, never from this page, which sends the browser
// nowhere.
//
// The code comes from what the user types, never from the page's address, so
// no link can arrive with one filled in. Whoever enters a code decides the
// sign-in it names, so the page tells the user to enter only a code their own
// terminal shows.

import { readConsentDetails, type ConsentDetails } from './oauth-provider.ts';
import { SecureSessionError, timedFetch } from './session.js';
import type { Session } from './session.js';

type Config = { realmServerURL: URL };

// The letters a user code is made of: consonants without look-alikes, so it
// reads aloud and never spells a word (the provider's `base-20`).
const USER_CODE_LETTERS = 'BCDFGHJKLMNPQRSTVWXZ';
const USER_CODE_LENGTH = 8;

// The code as the user typed it, in the form the page sends and shows:
// upper case, `XXXX-XXXX`. Undefined when what was typed, without its
// spaces and dashes, isn't eight of the code's letters.
export function userCodeFrom(typed: string): string | undefined {
  let letters = typed.toUpperCase().replace(/[\s-]/g, '');
  if (
    letters.length !== USER_CODE_LENGTH ||
    [...letters].some((letter) => !USER_CODE_LETTERS.includes(letter))
  ) {
    return undefined;
  }
  return `${letters.slice(0, 4)}-${letters.slice(4)}`;
}

// The provider's refusals, as fixed codes. Anything else is `failed`.
const REFUSALS = new Set([
  'bad-request',
  'signed-out',
  'forbidden',
  'unknown-code',
  'expired',
  'decided',
  'rate-limited',
  'unavailable',
]);

const MESSAGES: Record<string, string> = {
  'signed-out': 'Sign in to continue.',
  'unknown-code':
    'That code isn’t right. Check it against your terminal and try again.',
  expired:
    'That code has expired. Start signing in again in your terminal for a new one.',
  decided: 'That code has already been used.',
  'rate-limited': 'Too many tries. Wait a few minutes, then try again.',
};

// A refusal from the device routes, by its fixed code.
export class DeviceCodeRefusal extends SecureSessionError {}

async function deviceRequest(
  config: Config,
  session: Session,
  path: 'lookup' | 'decision',
  body: Record<string, unknown>,
): Promise<unknown> {
  let response: Response;
  try {
    response = await timedFetch(
      new URL(`_oauth-provider/device/${path}`, config.realmServerURL),
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${session.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      },
      'realm-server',
    );
  } catch (e) {
    if (e instanceof SecureSessionError) {
      throw e;
    }
    throw new SecureSessionError(0, 'network', 'Boxel could not be reached.');
  }
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    json = undefined;
  }
  if (!response.ok) {
    let error = (json as { error?: unknown } | undefined)?.error;
    let code =
      typeof error === 'string' && REFUSALS.has(error) ? error : 'failed';
    throw new DeviceCodeRefusal(
      response.status,
      code,
      MESSAGES[code] ?? 'Something went wrong. Try again.',
    );
  }
  return json;
}

// `POST /_oauth-provider/device/lookup`: the consent for the sign-in a code
// names.
export async function lookUpDeviceCode(
  config: Config,
  session: Session,
  userCode: string,
): Promise<ConsentDetails> {
  return readConsentDetails(
    await deviceRequest(config, session, 'lookup', { user_code: userCode }),
  );
}

// `POST /_oauth-provider/device/decision`: Allow or Deny, and whether to keep
// the connection for 30 days.
export async function decideDeviceCode(
  config: Config,
  session: Session,
  userCode: string,
  decision: { decision: 'allow' | 'deny'; renew: boolean },
): Promise<void> {
  await deviceRequest(config, session, 'decision', {
    user_code: userCode,
    decision: decision.decision,
    renew: decision.decision === 'allow' && decision.renew === true,
  });
}
