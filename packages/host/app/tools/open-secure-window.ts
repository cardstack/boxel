import { service } from '@ember/service';

import HostBaseTool from '../lib/host-base-tool';
import {
  SECURE_WINDOW_MODES,
  isSecureWindowMode,
  isSecureWindowName,
  secureWindowURL,
  type SecureWindowRequest,
  type SecureWindowTarget,
} from '../lib/secure-window';

import type SecureWindowService from '../services/secure-window';
import type * as BaseToolModule from '@cardstack/base/command';

// Opens the secure window, where the user enters, replaces, shares or swaps in a key,
// or connects an account at a service by signing in there through an OAuth
// app. This is the one way the app, a card and the AI assistant start that,
// so a user learns one flow and nothing builds a form of its own for a
// credential. The caller names what the key is for; it passes no destination
// and gets no value back, only whether the window opened. When the browser
// blocks the popup, the app shows a button that opens it on the user's click,
// and the result says so.
export default class OpenSecureWindowTool extends HostBaseTool<
  typeof BaseToolModule.OpenSecureWindowInput,
  typeof BaseToolModule.OpenSecureWindowResult
> {
  @service declare private secureWindow: SecureWindowService;

  static actionVerb = 'Open';

  description = `Open Boxel's secure window, the only place a user enters or shares an API key or connects an account at a service. Call it once when an operation is refused "Binding not approved" and the refusal names a credential slot "for the invoking user's own key", or a card says it needs the user's own key, and tell the user in the chat what you are opening and why. A stored key does not by itself fill the slot, so never reopen the window when the same refusal comes back. Never ask the user for a key, token, password or other credential in the chat. mode "enter-key": add a key, for an operation on a card instance (cardId and operation) or on a card type (module, name, realm and operation). mode "replace-key": replace the key an operation sends, when it is refused "Credential rejected", for an operation on a card instance (cardId and operation) or on a card type (module, name, realm and operation); the window finds the key from the user's approval, and when a workspace's shared key fills the slot it tells the user who can replace it. mode "share-key": share one of the user's keys into a workspace (realm). mode "connect": connect the user's account at a service that signs in with OAuth (such as GitHub), where the user signs in at the service itself instead of pasting a key; pass the same cardId and operation, or module, name, realm and operation, as for "enter-key", or a realm alone to offer the apps shared into that workspace. mode "swap-key": put one of the user's keys into a workspace's (realm) suspended share (share, the share's id). reason: one short line the window shows as the opener's words. The result says only whether the window opened ("opened") or the browser blocked it and the app shows the user a button that opens it ("blocked"); it never says what the user did there.`;

  async getInputType() {
    let commandModule = await this.loadToolModule();
    const { OpenSecureWindowInput } = commandModule;
    return OpenSecureWindowInput;
  }

  requireInputFields = ['mode'];

  protected async run(
    input: BaseToolModule.OpenSecureWindowInput,
  ): Promise<BaseToolModule.OpenSecureWindowResult> {
    let request = secureWindowRequest(input);
    let status = this.secureWindow.open(secureWindowURL(request));
    let commandModule = await this.loadToolModule();
    const { OpenSecureWindowResult } = commandModule;
    return new OpenSecureWindowResult({ status });
  }
}

function secureWindowRequest(
  input: BaseToolModule.OpenSecureWindowInput,
): SecureWindowRequest {
  let { mode } = input;
  if (!isSecureWindowMode(mode)) {
    throw new Error(
      `mode must be one of ${SECURE_WINDOW_MODES.map((m) => `"${m}"`).join(', ')}`,
    );
  }
  let reason = input.reason?.trim() || undefined;
  if (mode === 'share-key') {
    return { mode, realm: name('realm', input.realm), reason };
  }
  if (mode === 'swap-key') {
    let share = input.share?.trim();
    if (!share) {
      throw new Error('share is required');
    }
    return { mode, realm: name('realm', input.realm), share, reason };
  }
  if (mode === 'connect') {
    let target = targetOf(input);
    // A type target names its realm; otherwise a realm alone is what the
    // account is connected for.
    if (!target && input.realm?.trim()) {
      return { mode, realm: name('realm', input.realm), reason };
    }
    return { mode, target, reason };
  }
  let target = targetOf(input);
  if (mode === 'replace-key') {
    if (!target?.operation) {
      throw new Error(
        'replace-key is for an operation on a card (cardId and operation) or a card type (module, name, realm and operation)',
      );
    }
    return {
      mode,
      target: target as SecureWindowTarget & { operation: string },
      reason,
    };
  }
  return { mode, target, reason };
}

function targetOf(
  input: BaseToolModule.OpenSecureWindowInput,
): SecureWindowTarget | undefined {
  let operation = input.operation?.trim() || undefined;
  if (input.cardId) {
    return {
      kind: 'instance',
      card: name('cardId', input.cardId),
      operation,
    };
  }
  if (input.module || input.name) {
    if (!input.name?.trim()) {
      throw new Error('a card type needs its export name (name)');
    }
    return {
      kind: 'type',
      module: name('module', input.module),
      name: input.name.trim(),
      realm: name('realm', input.realm),
      operation,
    };
  }
  if (operation) {
    throw new Error(
      'an operation needs the card (cardId) or card type (module, name and realm) it is on',
    );
  }
  return undefined;
}

// A realm, card or module, as the window reads one: an http(s) URL or a
// prefix-form id.
function name(field: string, value: string | undefined): string {
  let trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(`${field} is required`);
  }
  if (!isSecureWindowName(trimmed)) {
    throw new Error(`${field} must be a URL or a prefix-form id`);
  }
  return trimmed;
}
