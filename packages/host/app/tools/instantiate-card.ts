/**
 * Host command that instantiates a card from a JSON document using the store.
 * Runs in the prerenderer's headless Chrome — the sandbox for untrusted code.
 *
 * Uses `store.__dangerousCreateFromSerialized(...)` to materialize a live card
 * instance directly from serialized JSON without persisting it back to the
 * realm. We initially tried the public API (`store.add(doc, { doNotPersist: true })`)
 * but it relaxes serialization errors — `Field.validate()` failures are caught
 * internally and logged as console warnings rather than thrown. This is the
 * correct behavior for the UI (a broken card should degrade gracefully), but
 * the factory needs those validation errors to propagate as thrown exceptions
 * so they can be reported to the agent as actionable failures.
 *
 * Used by the software-factory's InstantiateValidationStep via `_run-command`.
 */

import { service } from '@ember/service';

import type * as BaseToolModule from 'https://cardstack.com/base/command';

import HostBaseTool from '../lib/host-base-tool';

import type StoreService from '../services/store';

export default class InstantiateCardTool extends HostBaseTool<
  typeof BaseToolModule.InstantiateCardInput,
  typeof BaseToolModule.InstantiateCardResult
> {
  description = 'Instantiate a card from JSON via the store in the prerenderer';
  static actionVerb = 'Instantiate';

  @service declare private store: StoreService;

  async getInputType() {
    let commandModule = await this.loadToolModule();
    return commandModule.InstantiateCardInput;
  }

  requireInputFields = ['moduleIdentifier', 'cardName', 'realmIdentifier'];

  protected async run(
    input: BaseToolModule.InstantiateCardInput,
  ): Promise<BaseToolModule.InstantiateCardResult> {
    let moduleUrl = input.moduleIdentifier;
    let cardName = input.cardName;
    let realmUrl = input.realmIdentifier;

    if (!moduleUrl) {
      throw new Error('moduleUrl is required');
    }

    if (!cardName) {
      throw new Error('cardName is required');
    }

    if (!realmUrl) {
      throw new Error('realmUrl is required');
    }

    this.validateModuleUrl(moduleUrl, realmUrl);

    let commandModule = await this.loadToolModule();

    try {
      // Reset the loader to clear cached modules from prior runs.
      // Without this, the Loader's internal module Map retains stale
      // compiled bytecode — edits the factory agent makes between
      // validation turns are invisible to instantiation.
      this.loaderService.resetLoader({
        clearFetchCache: true,
        reason:
          'instantiate-card: fresh instantiation requires uncached loader',
      });

      // Build or parse the card document
      let doc;
      if (input.instanceData) {
        doc = JSON.parse(input.instanceData);

        // Enforce that the instance data's adoptsFrom matches the requested
        // moduleUrl/cardName. Without this, a caller could pass a safe
        // moduleUrl but point instanceData at an external module.
        let adoptsFrom = doc?.data?.meta?.adoptsFrom;
        if (adoptsFrom) {
          if (
            (adoptsFrom.module != null && adoptsFrom.module !== moduleUrl) ||
            (adoptsFrom.name != null && adoptsFrom.name !== cardName)
          ) {
            throw new Error(
              `instanceData adoptsFrom (${adoptsFrom.module}::${adoptsFrom.name}) does not match moduleUrl/cardName (${moduleUrl}::${cardName})`,
            );
          }
        }
        // Ensure adoptsFrom is set to the validated input values
        doc.data ??= {};
        doc.data.meta ??= {};
        doc.data.meta.adoptsFrom = { module: moduleUrl, name: cardName };
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

      // We use __dangerousCreateFromSerialized instead of store.add because
      // store.add relaxes serialization errors — Field.validate() failures
      // are caught and logged as console warnings rather than thrown. We
      // need those errors to propagate so the factory can report them.
      let cardId = doc?.data?.id;
      let resolveFrom = cardId ?? realmUrl;
      await this.store.__dangerousCreateFromSerialized(
        doc.data,
        doc,
        resolveFrom ? new URL(resolveFrom) : undefined,
      );

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

// Pre-rename spellings: realm content references these classes by named
// export in imports and codeRefs, so the old names stay importable.
export { InstantiateCardTool as InstantiateCardCommand };
