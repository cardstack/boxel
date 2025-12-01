import { service } from '@ember/service';

import { isCardInstance } from '@cardstack/runtime-common';

import type * as CardAPI from 'https://cardstack.com/base/card-api';
import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import CopyCardToRealmCommand from './copy-card';

import type OperatorModeStateService from '../services/operator-mode-state-service';
import type RealmService from '../services/realm';
import type StoreService from '../services/store';

export default class CopyAndEditCommand extends HostBaseCommand<
  typeof BaseCommandModule.CopyAndEditInput,
  undefined
> {
  @service operatorModeStateService!: OperatorModeStateService;
  @service realm!: RealmService;
  @service store!: StoreService;

  #cardAPI?: typeof CardAPI;

  static actionVerb = 'Copy and Edit';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { CopyAndEditInput } = commandModule;
    return CopyAndEditInput;
  }

  private async loadCardAPI() {
    if (!this.#cardAPI) {
      this.#cardAPI = await this.loaderService.loader.import<typeof CardAPI>(
        'https://cardstack.com/base/card-api',
      );
    }
    return this.#cardAPI;
  }

  protected async run(
    input: BaseCommandModule.CopyAndEditInput,
  ): Promise<undefined> {
    if (!input.card?.id) {
      throw new Error('copy-and-edit requires a card with an id');
    }

    let targetRealm = this.realm.url(input.card.id as string);
    if (!targetRealm) {
      throw new Error('Could not determine realm for card copy');
    }
    if (!targetRealm.endsWith('/')) {
      targetRealm = `${targetRealm}/`;
    }
    if (!this.realm.canWrite(targetRealm)) {
      throw new Error(`Do not have write permissions to ${targetRealm}`);
    }

    let copyCardCommand = new CopyCardToRealmCommand(this.commandContext);
    let { newCardId } = await copyCardCommand.execute({
      sourceCard: input.card,
      targetRealm,
    });

    await this.renameNewCard(newCardId);

    let linkedParent = this.deriveLinkedParent(input.card.id as string);
    if (linkedParent) {
      await this.linkToParentCard(
        linkedParent.parentId,
        input.card.id as string,
        newCardId,
        linkedParent.relationshipContext,
      );

      let newCard = await this.store.get(newCardId);
      if (isCardInstance(newCard)) {
        let stackIndex = this.findStackIndexForCard(input.card.id as string);

        // Prefer replacing the original card in-place; fall back to the parent's stack
        if (stackIndex === undefined) {
          stackIndex = this.findStackIndexForCard(linkedParent.parentId);
        }

        if (stackIndex !== undefined) {
          this.operatorModeStateService.replaceCardOnStack(
            input.card.id as string,
            newCardId,
            stackIndex,
            'edit',
          );
        }
      }
    }
    return;
  }

  private async renameNewCard(newCardId: string) {
    let newCard = await this.store.get(newCardId);
    if (!isCardInstance(newCard)) {
      return;
    }
    let suffix =
      newCardId.split('/').filter(Boolean).pop()?.slice(-4) ??
      newCardId.slice(-4);
    let renamed = false;
    if (
      newCard.cardInfo &&
      typeof (newCard as any).cardInfo?.title === 'string'
    ) {
      let currentTitle = (newCard as any).cardInfo.title;
      (newCard as any).cardInfo.title = `${currentTitle} (Copy ${suffix})`;
      renamed = true;
    }
    if (renamed && newCard.id) {
      this.store.save(newCard.id as string);
    }
  }

  async linkToParentCard(
    parentCardId: string,
    originalCardId: string,
    newCardId: string,
    relationshipContext?: {
      fieldName?: string;
      fieldType?: 'linksTo' | 'linksToMany';
    },
  ): Promise<void> {
    let parentCard = await this.store.get(parentCardId);
    if (!isCardInstance(parentCard)) {
      throw new Error(
        `Failed to load parent card ${parentCardId} to link new copy`,
      );
    }

    let newCard = await this.store.get(newCardId);
    if (!isCardInstance(newCard)) {
      throw new Error(
        `Failed to load new copied card ${newCardId} for linking`,
      );
    }

    let cardApi = await this.loadCardAPI();
    let normalizedOriginal = originalCardId.replace(/\.json$/, '');
    let fields = cardApi.getFields(parentCard, {
      usedLinksToFieldsOnly: true,
      includeComputeds: false,
    });

    // Note: if the parent came from a query-only stack entry, this won't link because it only patches real linksTo/linksToMany fields on a loaded parent card,
    // but the copied card is still created/added and can be used independently.
    // Only update parent relationships that are defined as fields (linksTo/linksToMany)
    for (let [fieldName, fieldDef] of Object.entries(fields)) {
      if (
        relationshipContext?.fieldName &&
        fieldName !== relationshipContext.fieldName
      ) {
        continue;
      }
      if (
        relationshipContext?.fieldType &&
        fieldDef.fieldType !== relationshipContext.fieldType
      ) {
        continue;
      }
      if (
        (fieldDef.fieldType === 'linksTo' ||
          fieldDef.fieldType === 'linksToMany') &&
        'card' in fieldDef &&
        fieldDef.card &&
        !(
          newCard instanceof (fieldDef as any).card ||
          newCard.constructor?.name === (fieldDef as any).card?.name
        )
      ) {
        continue;
      }
      let currentValue = (parentCard as any)[fieldName];
      if (fieldDef.fieldType === 'linksTo') {
        (parentCard as any)[fieldName] = newCard;
        if (parentCard.id) {
          this.store.save(parentCard.id as string);
        }
        return;
      } else if (
        fieldDef.fieldType === 'linksToMany' &&
        Array.isArray(currentValue)
      ) {
        let replaced: any[] = [];
        let found = false;
        for (let item of currentValue) {
          let itemId = item?.id ?? item;
          if (itemId && itemId.replace(/\.json$/, '') === normalizedOriginal) {
            replaced.push(newCard);
            found = true;
          } else {
            replaced.push(item);
          }
        }
        if (found) {
          (parentCard as any)[fieldName] = replaced;
          if (parentCard.id) {
            this.store.save(parentCard.id as string);
          }
          return;
        }
      }
    }
  }

  deriveLinkedParent(cardId: string):
    | {
        parentId: string;
        relationshipContext?: {
          fieldName?: string;
          fieldType?: 'linksTo' | 'linksToMany';
        };
      }
    | undefined {
    let stacks = this.operatorModeStateService.state?.stacks ?? [];
    let normalizedId = cardId.replace(/\.json$/, '');
    for (let stackIndex = 0; stackIndex < stacks.length; stackIndex++) {
      let stack = stacks[stackIndex];
      try {
        let item = this.operatorModeStateService.findCardInStack(
          normalizedId,
          stackIndex,
        );
        let itemIndex = stack.indexOf(item);
        if (itemIndex > 0) {
          let parentItem = stack[itemIndex - 1];
          return {
            parentId: parentItem.id,
            relationshipContext: item.relationshipContext,
          };
        }
      } catch (err) {
        if (
          err instanceof Error &&
          (err.message.includes('Could not find card') ||
            (err.message.includes('Stack') &&
              err.message.includes('does not exist')))
        ) {
          continue;
        }
        throw err;
      }
    }
    return undefined;
  }

  private findStackIndexForCard(cardId: string): number | undefined {
    let stacks = this.operatorModeStateService.state?.stacks ?? [];
    for (let stackIndex = 0; stackIndex < stacks.length; stackIndex++) {
      let stack = stacks[stackIndex];
      if (stack.some((item) => item.id === cardId)) {
        return stackIndex;
      }
    }
    return undefined;
  }
}
