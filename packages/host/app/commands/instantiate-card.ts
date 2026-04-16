/**
 * Host command that instantiates a card from a JSON document using the store.
 * Runs in the prerenderer's headless Chrome — the sandbox for untrusted code.
 *
 * Uses `store.add(doc, { doNotPersist: true })` to create an instance without
 * writing it back to the realm. This validates that the card definition can
 * produce a live instance from JSON — catching type mismatches, broken field
 * deserializers, and invalid relationships that `loader.import()` alone misses.
 *
 * Used by the software-factory's InstantiateValidationStep via `_run-command`.
 */

import { service } from '@ember/service';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import type StoreService from '../services/store';

export default class InstantiateCardCommand extends HostBaseCommand<
  typeof BaseCommandModule.InstantiateCardInput,
  typeof BaseCommandModule.InstantiateCardResult
> {
  description = 'Instantiate a card from JSON via the store in the prerenderer';
  static actionVerb = 'Instantiate';

  @service declare private store: StoreService;

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    return commandModule.InstantiateCardInput;
  }

  requireInputFields = ['moduleUrl', 'cardName'];

  protected async run(
    input: BaseCommandModule.InstantiateCardInput,
  ): Promise<BaseCommandModule.InstantiateCardResult> {
    let moduleUrl = input.moduleUrl;
    let cardName = input.cardName;
    let realmUrl = input.realmUrl;

    if (!moduleUrl) {
      throw new Error('moduleUrl is required');
    }

    if (!cardName) {
      throw new Error('cardName is required');
    }

    if (realmUrl) {
      this.validateModuleUrl(moduleUrl, realmUrl);
    }

    let commandModule = await this.loadCommandModule();

    try {
      // Build or parse the card document
      let doc;
      if (input.instanceData) {
        doc = JSON.parse(input.instanceData);
      } else {
        // Minimal document — just the adoptsFrom, no field data
        doc = {
          data: {
            type: 'card',
            attributes: {},
            meta: {
              adoptsFrom: {
                module: moduleUrl,
                name: cardName,
              },
            },
          },
        };
      }

      // Instantiate via the store without persisting.
      // Use the card's id (if present) as relativeTo so relative
      // adoptsFrom.module paths resolve correctly. Fall back to realmUrl.
      let cardId = doc?.data?.id;
      let resolveFrom = cardId ?? realmUrl;
      console.log(
        `[instantiate-card] cardId=${cardId}, realmUrl=${realmUrl}, resolveFrom=${resolveFrom}, adoptsFrom=${JSON.stringify(doc?.data?.meta?.adoptsFrom)}`,
      );
      await this.store.add(doc, {
        doNotPersist: true,
        relativeTo: resolveFrom ? new URL(resolveFrom) : undefined,
      });

      return new commandModule.InstantiateCardResult({ passed: true });
    } catch (error: any) {
      let message = error?.message ?? String(error);
      let stack = error?.stack;

      return new commandModule.InstantiateCardResult({
        passed: false,
        error: message,
        stackTrace: stack,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // URL validation helpers (SSRF prevention)
  // ---------------------------------------------------------------------------

  /**
   * Ensures moduleUrl is an http(s) URL that lives under the given realmUrl.
   * Throws if validation fails.
   */
  private validateModuleUrl(moduleUrl: string, realmUrl: string): void {
    this.assertHttpOrHttpsUrl(moduleUrl, 'moduleUrl');
    this.assertHttpOrHttpsUrl(realmUrl, 'realmUrl');

    let mod = new URL(moduleUrl);
    let realm = new URL(realmUrl);

    if (mod.origin !== realm.origin) {
      throw new Error(
        `moduleUrl origin (${mod.origin}) does not match realmUrl origin (${realm.origin})`,
      );
    }

    let realmPath = this.normalizeRealmPathname(realm.pathname);
    if (!mod.pathname.startsWith(realmPath)) {
      throw new Error(
        `moduleUrl path (${mod.pathname}) is not under realmUrl path (${realmPath})`,
      );
    }
  }

  private assertHttpOrHttpsUrl(value: string, label: string): void {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error(`${label} is not a valid URL: ${value}`);
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error(
        `${label} must use http or https scheme, got ${url.protocol}`,
      );
    }
  }

  private normalizeRealmPathname(pathname: string): string {
    return pathname.endsWith('/') ? pathname : `${pathname}/`;
  }
}
