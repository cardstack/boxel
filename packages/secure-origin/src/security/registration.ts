// Creating a Boxel account: the Matrix server's registration, driven from
// the secure origin. It asks for the email validation link, then follows the
// stages the server asks for: an invite code where the server requires one,
// and the email validation, which it polls for until the link in the email is
// followed. Once the account exists, it sets the account's display name and
// signs the registration's own Matrix session out.
//
// The password and the invite code are held here, and sent from here, for
// as long as the registration runs. The page that draws the registration
// reads only what it shows: which step the registration is at, and the error
// to show there.

import {
  clientSecret as newClientSecret,
  logout,
  MatrixError,
  register,
  requestEmailToken,
  setDisplayName,
} from './matrix.js';

// How often the registration asks whether the email has been validated.
export const EMAIL_POLL_INTERVAL_MS = 1000;

export const NO_NETWORK_ERROR = 'Could not connect to server';
export const INVALID_INVITE_CODE =
  'This registration token does not exist or has exceeded its usage limit.';

const REGISTRATION_TOKEN = 'm.login.registration_token';
const EMAIL_IDENTITY = 'm.login.email.identity';
const DUMMY = 'm.login.dummy';

export interface Flows {
  flows?: { stages?: string[] }[];
  completed?: string[];
  session?: string;
}

export interface Account {
  user_id: string;
  access_token: string;
}

// Where a registration stands once a step of it returns.
export type Outcome =
  // The account exists.
  | { step: 'account'; account: Account }
  // The server asks for an invite code, and `error` says why the last one,
  // if any, was refused.
  | { step: 'invite-code'; error?: string }
  // The registration form is shown again, with the error on the field it
  // belongs to, or on the form.
  | { step: 'form'; field: 'username' | 'email'; error: string }
  | { step: 'form'; field?: undefined; error: string }
  // `stop()` ended it while it waited on the email validation.
  | { step: 'stopped' };

// The stage the server asks for next: the first not yet completed, of the
// first flow that every completed stage belongs to.
export function nextStage({ flows = [], completed = [] }: Flows) {
  let flow =
    flows.find(({ stages = [] }) =>
      completed.every((stage) => stages.includes(stage)),
    ) ?? flows[0];
  return flow?.stages?.find((stage) => !completed.includes(stage));
}

// The Matrix server's error, in the app's words.
export function registrationErrorText(error: unknown): string {
  let { status, data, message } = (error ?? {}) as {
    status?: number;
    data?: { error?: unknown };
    message?: unknown;
  };
  if (status === 0) {
    return NO_NETWORK_ERROR;
  }
  let text = String(data?.error ?? message ?? '');
  if (text.includes('Registration has been disabled')) {
    return 'Registration has been disabled';
  }
  if (text.includes('Unable to parse email address')) {
    return 'Email address is invalid';
  }
  return text;
}

// Why a username can't be registered, before the server is asked whether it
// is taken: one that could collide with the realm server's API, or with
// realms' own users.
export function usernameError(username: string): string | undefined {
  if (!username) {
    return 'Username is missing';
  }
  if (username.startsWith('_')) {
    return 'Username cannot start with an underscore';
  }
  if (username.startsWith('realm/')) {
    return 'Username cannot start with "realm/"';
  }
  return undefined;
}

function formError(error: unknown): Outcome {
  return {
    step: 'form',
    error: `There was an error registering: ${registrationErrorText(error)}`,
  };
}

export interface RegistrationDetails {
  name: string;
  email: string;
  username: string;
  password: string;
  // Where the email validation link lands once the server has validated the
  // address.
  nextLink: string;
}

export interface RegistrationOptions {
  // Heard each time the registration is waiting on the email validation.
  onAwaitingEmail?: () => void;
  delay?: (ms: number) => Promise<void>;
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export class Registration {
  readonly details: RegistrationDetails;
  // The invite code the server accepted, which the account's first sign-in
  // records.
  token: string | undefined;
  private clientSecret = newClientSecret();
  private sid: string | undefined;
  private sendAttempt = 0;
  private session: string | undefined;
  private stopped = false;
  private onAwaitingEmail: () => void;
  private delay: (ms: number) => Promise<void>;

  constructor(
    details: RegistrationDetails,
    { onAwaitingEmail, delay = wait }: RegistrationOptions = {},
  ) {
    this.details = details;
    this.onAwaitingEmail = onAwaitingEmail ?? (() => undefined);
    this.delay = delay;
  }

  // Sends the email validation link, and follows the server's stages from
  // there.
  async start(): Promise<Outcome> {
    try {
      await this.sendValidationEmail();
    } catch (e) {
      if (
        e instanceof MatrixError &&
        e.status === 400 &&
        e.errcode === 'M_THREEPID_IN_USE'
      ) {
        return {
          step: 'form',
          field: 'email',
          error: 'Email address is already attached to a Boxel account',
        };
      }
      return formError(e);
    }
    return await this.continue(undefined);
  }

  // Sends the email validation link again. The registration keeps waiting
  // on whichever link is followed.
  async sendValidationEmail(): Promise<void> {
    this.sid = await requestEmailToken('registration', {
      email: this.details.email,
      clientSecret: this.clientSecret,
      sendAttempt: this.sendAttempt + 1,
      nextLink: this.details.nextLink,
    });
    this.sendAttempt++;
  }

  async submitInviteCode(token: string): Promise<Outcome> {
    this.token = token;
    return await this.continue({
      type: REGISTRATION_TOKEN,
      token,
      session: this.session,
    });
  }

  // Ends the registration's polling. A step under way returns as soon as its
  // request does.
  stop() {
    this.stopped = true;
  }

  // Names the new account and signs the registration's own Matrix session
  // out. Neither is needed for the account to be signed in to, so a failure
  // of either is let go.
  async setUp(account: Account): Promise<void> {
    await setDisplayName(
      account.user_id,
      account.access_token,
      this.details.name,
    ).catch(() => undefined);
    await logout(account.access_token).catch(() => undefined);
  }

  // Makes the registration request with `auth` for the stage at hand, and
  // follows the server to the next stage until the account exists, or the
  // server asks for something only the user can give.
  private async continue(
    auth: Record<string, unknown> | undefined,
  ): Promise<Outcome> {
    let polling = false;
    for (;;) {
      try {
        let account = (await register({
          username: this.details.username,
          password: this.details.password,
          auth,
        })) as Account;
        return { step: 'account', account };
      } catch (e) {
        let error = e as MatrixError;
        let flows =
          error.status === 401 ? (error.data as Flows | undefined) : undefined;
        if (flows?.flows?.length) {
          this.session = flows.session;
          let stage = nextStage(flows);
          if (stage === REGISTRATION_TOKEN) {
            // A refused invite code is asked for again.
            return auth?.type === REGISTRATION_TOKEN
              ? { step: 'invite-code', error: INVALID_INVITE_CODE }
              : { step: 'invite-code' };
          }
          if (stage === EMAIL_IDENTITY) {
            this.onAwaitingEmail();
            if (polling) {
              await this.delay(EMAIL_POLL_INTERVAL_MS);
            }
            if (this.stopped) {
              return { step: 'stopped' };
            }
            polling = true;
            auth = {
              type: EMAIL_IDENTITY,
              session: this.session,
              threepid_creds: {
                sid: this.sid,
                client_secret: this.clientSecret,
              },
            };
            continue;
          }
          if (stage === DUMMY) {
            auth = { type: DUMMY, session: this.session };
            continue;
          }
        }
        if (error.errcode === 'M_USER_IN_USE') {
          return {
            step: 'form',
            field: 'username',
            error: 'Username is already taken',
          };
        }
        if (auth?.type === REGISTRATION_TOKEN) {
          return {
            step: 'invite-code',
            error: error.status === 0 ? NO_NETWORK_ERROR : INVALID_INVITE_CODE,
          };
        }
        return formError(error);
      }
    }
  }
}
