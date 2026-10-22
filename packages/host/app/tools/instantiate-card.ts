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

import { rri } from '@cardstack/runtime-common';

import HostBaseTool from '../lib/host-base-tool';
import { assertModuleInRealm } from '../utils/assert-module-in-realm';

import type NetworkService from '../services/network';
import type StoreService from '../services/store';
import type * as BaseToolModule from '@cardstack/base/command';

export default class InstantiateCardTool extends HostBaseTool<
  typeof BaseToolModule.InstantiateCardInput,
  typeof BaseToolModule.InstantiateCardResult
> {
  description = 'Instantiate a card from JSON via the store in the prerenderer';
  static actionVerb = 'Instantiate';

  @service declare private network: NetworkService;
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

    assertModuleInRealm(moduleUrl, realmUrl, this.network.virtualNetwork);

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
        resolveFrom ? rri(resolveFrom) : undefined,
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
}

// Pre-rename spellings: realm content references these classes by named
// export in imports and codeRefs, so the old names stay importable.
export { InstantiateCardTool as InstantiateCardCommand };
