import { buildWaiter } from '@ember/test-waiters';
import { tracked } from '@glimmer/tracking';

// The fields a password is typed into live in a frame on the secure origin
// (`packages/realm-server/secure-origin/credentials.js`), where card code in
// this page can't read them. A form that has such fields owns one of these:
// it learns from the frame whether the fields are filled in, never what is in
// them, and asks the frame to make the Matrix request that carries the
// password, passing the parts of the request that aren't secret.

export type CredentialForm =
  | 'login'
  | 'cli-login'
  | 'register'
  | 'reset'
  | 'change-password'
  | 'confirm-password';

// The Matrix server's response, as the frame relays it.
export interface CredentialFieldsResult {
  ok: boolean;
  status: number;
  body: Record<string, any>;
}

export type CredentialOperation =
  | { operation: 'login' }
  | { operation: 'cli-login' }
  | {
      operation: 'register';
      args: { username: string; auth: Record<string, unknown> };
    }
  | {
      operation: 'set-password';
      args: {
        auth: Record<string, unknown>;
        accessToken?: string;
        // The account whose password this is, by Matrix id or email address.
        // Once the password is changed, the fields end the account's secure
        // sessions at the realm server, proving it with the new password.
        account?: string;
      };
    }
  | {
      operation: 'add-threepid';
      args: {
        auth: Record<string, unknown>;
        accessToken: string;
        clientSecret: string;
        sid: string;
      };
    };

// How the component that hosts the frame delivers a message to it.
export interface CredentialFieldsPort {
  post(message: Record<string, unknown>): void;
}

const waiter = buildWaiter('credential-fields:request');

let nextRequestId = 0;

export class CredentialFields {
  // Every field is filled in and none shows an error.
  @tracked complete = false;
  // Which fields have something in them, by name.
  @tracked filled: Record<string, boolean> = {};

  // A field was typed into.
  onInput?: (field: string) => void;
  // Enter was pressed in a field.
  onSubmitRequest?: () => void;

  private port: CredentialFieldsPort | undefined;
  private context: Record<string, unknown> = {};
  private fieldErrors = new Map<string, string | undefined>();
  private validations = new Map<
    number,
    { resolve: (complete: boolean) => void; waiterToken: unknown }
  >();
  private pending = new Map<
    number,
    {
      resolve: (result: CredentialFieldsResult) => void;
      waiterToken: unknown;
    }
  >();

  // The frame is ready for messages.
  connect(port: CredentialFieldsPort) {
    this.port = port;
    port.post({ type: 'context', ...this.context });
    for (let [field, message] of this.fieldErrors) {
      port.post({ type: 'field-error', field, message });
    }
  }

  disconnect() {
    this.port = undefined;
    for (let [id, { resolve, waiterToken }] of this.pending) {
      resolve({
        ok: false,
        status: 0,
        body: { error: 'The form was closed.' },
      });
      waiter.endAsync(waiterToken);
      this.pending.delete(id);
    }
    for (let [id, { resolve, waiterToken }] of this.validations) {
      resolve(false);
      waiter.endAsync(waiterToken);
      this.validations.delete(id);
    }
  }

  // Not secret: the account a new password belongs to, which lets a password
  // manager save it against the right username.
  setContext(context: { username?: string }) {
    this.context = context;
    this.port?.post({ type: 'context', ...context });
  }

  // Shows an error on a field, as its own validation does. `undefined` clears
  // it.
  setFieldError(field: string, message: string | undefined) {
    this.fieldErrors.set(field, message);
    this.port?.post({ type: 'field-error', field, message });
  }

  // Has the frame check its fields, as it does when one loses focus, and
  // answers whether they are ready to submit. A form asks before it acts:
  // `complete` may not yet include a check the frame made a moment ago, such
  // as on the field the user left by clicking the form's button.
  validate(): Promise<boolean> {
    let port = this.port;
    if (!port) {
      return Promise.resolve(false);
    }
    let id = ++nextRequestId;
    let waiterToken = waiter.beginAsync();
    return new Promise((resolve) => {
      this.validations.set(id, { resolve, waiterToken });
      port.post({ type: 'validate', id });
    });
  }

  // Has the frame make a request with the passwords typed into it.
  submit(request: CredentialOperation): Promise<CredentialFieldsResult> {
    let port = this.port;
    if (!port) {
      return Promise.resolve({
        ok: false,
        status: 0,
        body: { error: 'The form is not ready yet.' },
      });
    }
    let id = ++nextRequestId;
    let waiterToken = waiter.beginAsync();
    return new Promise((resolve) => {
      this.pending.set(id, { resolve, waiterToken });
      port.post({
        type: 'submit',
        id,
        operation: request.operation,
        args: 'args' in request ? request.args : undefined,
      });
    });
  }

  // A message from the frame, whose origin and window the component has
  // already checked.
  receive(message: Record<string, unknown>) {
    switch (message.type) {
      case 'state':
        this.complete = Boolean(message.complete);
        this.filled = {
          ...((message.filled as Record<string, boolean>) ?? {}),
        };
        break;
      case 'input':
        this.fieldErrors.delete(String(message.field));
        this.onInput?.(String(message.field));
        break;
      case 'submit-request':
        this.onSubmitRequest?.();
        break;
      case 'validated': {
        let id = Number(message.id);
        let entry = this.validations.get(id);
        if (!entry) {
          return;
        }
        this.validations.delete(id);
        entry.resolve(Boolean(message.complete));
        waiter.endAsync(entry.waiterToken);
        break;
      }
      case 'result': {
        let id = Number(message.id);
        let entry = this.pending.get(id);
        if (!entry) {
          return;
        }
        this.pending.delete(id);
        entry.resolve({
          ok: Boolean(message.ok),
          status: Number(message.status) || 0,
          body:
            message.body && typeof message.body === 'object'
              ? (message.body as Record<string, any>)
              : {},
        });
        waiter.endAsync(entry.waiterToken);
        break;
      }
    }
  }
}

// The error the Matrix SDK would have thrown for a failed request, so a form
// handles a failure from the frame exactly as it handled one from the SDK.
export function credentialFieldsError(result: CredentialFieldsResult): Error & {
  httpStatus: number;
  errcode: string | undefined;
  data: Record<string, any>;
} {
  let data = result.body ?? {};
  let error = new Error(
    typeof data.error === 'string'
      ? data.error
      : `Request failed (${result.status})`,
  ) as Error & {
    httpStatus: number;
    status: number;
    errcode: string | undefined;
    data: Record<string, any>;
  };
  error.httpStatus = result.status;
  error.status = result.status;
  error.errcode = typeof data.errcode === 'string' ? data.errcode : undefined;
  error.data = data;
  return error;
}
