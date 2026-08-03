import { service } from '@ember/service';

import { isCardInstance, type CodeRef } from '@cardstack/runtime-common';

import HostBaseTool from '../lib/host-base-tool';

import CopyCardToRealmTool from './copy-card';

import type OperatorModeStateService from '../services/operator-mode-state-service';
import type RealmService from '../services/realm';
import type RealmSandboxService from '../services/realm-sandbox';
import type StoreService from '../services/store';
import type * as CardAPI from '@cardstack/base/card-api';
import type * as BaseToolModule from '@cardstack/base/command';

export default class CopyAndEditTool extends HostBaseTool<
  typeof BaseToolModule.CopyAndEditInput,
  undefined
> {
  @service operatorModeStateService!: OperatorModeStateService;
  @service realm!: RealmService;
  @service realmSandbox!: RealmSandboxService;
  @service store!: StoreService;

  #cardAPI?: typeof CardAPI;

  static actionVerb = 'Copy and Edit';

  async getInputType() {
    let commandModule = await this.loadToolModule();
    const { CopyAndEditInput } = commandModule;
    return CopyAndEditInput;
  }

  private async loadCardAPI() {
    if (!this.#cardAPI) {
      this.#cardAPI = await this.loaderService.loader.import<typeof CardAPI>(
        '@cardstack/base/card-api',
      );
    }
    return this.#cardAPI;
  }

  protected async run(
    input: BaseToolModule.CopyAndEditInput,
  ): Promise<undefined> {
    if (!input.card?.id) {
      throw new Error('copy-and-edit requires a card with an id');
    }

    let targetRealm = this.operatorModeStateService.realmURL;
    if (!targetRealm) {
      throw new Error('Could not determine interact realm for card copy');
    }
    if (!targetRealm.endsWith('/')) {
      targetRealm = `${targetRealm}/`;
    }
    if (!this.realm.canWrite(targetRealm)) {
      throw new Error(`Do not have write permissions to ${targetRealm}`);
    }

    let copyCardCommand = new CopyCardToRealmTool(this.toolContext);
    let { newCardId } = await copyCardCommand.execute({
      sourceCard: input.card,
      targetRealm,
    });

    await this.renameNewCard(newCardId);

    let stackIndex = this.findStackIndexForCard(input.card.id as string);

    let linkedParent = this.deriveLinkedParent(input.card.id as string);
    if (linkedParent) {
      await this.linkToParentCard(
        linkedParent.parentId,
        input.card.id as string,
        newCardId,
        linkedParent.relationshipContext,
      );

      // Prefer replacing the original card in-place; fall back to the parent's stack
      if (stackIndex === undefined) {
        stackIndex = this.findStackIndexForCard(linkedParent.parentId);
      }
    }

    if (stackIndex !== undefined) {
      this.operatorModeStateService.replaceCardOnStack(
        input.card.id as string,
        newCardId,
        stackIndex,
        'edit',
      );
    }
    return undefined;
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
      typeof (newCard as any).cardInfo?.name === 'string'
    ) {
      let currentTitle = (newCard as any).cardInfo.name;
      (newCard as any).cardInfo.name = `${currentTitle} (Copy ${suffix})`;
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
      // fieldName may be a dotted path (e.g. "cardInfo.theme")
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
    let targetPath = relationshipContext?.fieldName?.includes('.')
      ? relationshipContext.fieldName
      : relationshipContext?.fieldName
        ? (this.realmSandbox.opaqueRelationshipPath(
            parentCard,
            relationshipContext.fieldName,
          ) ??
          this.findRelationshipPath(parentCard, relationshipContext.fieldName))
        : undefined;

    // Opaque authored records expose relationship values as inert data, not
    // nested CardDef instances that Card API reflection can walk. The overlay
    // already supplies the selected relationship's path and cardinality, so
    // use the explicit mutation boundary instead of re-introspecting it.
    if (targetPath && relationshipContext?.fieldType === 'linksTo') {
      if (
        this.realmSandbox.setOpaqueRelationshipPath(
          parentCard,
          targetPath,
          newCard,
        )
      ) {
        if (parentCard.id) {
          this.store.save(parentCard.id as string);
        }
        return;
      }
    }
    if (targetPath && relationshipContext?.fieldType === 'linksToMany') {
      let currentValue = this.dotGetter(targetPath, parentCard);
      if (Array.isArray(currentValue)) {
        let found = false;
        let replaced = currentValue.map((item) => {
          let itemId = item?.id ?? item;
          if (itemId && itemId.replace(/\.json$/, '') === normalizedOriginal) {
            found = true;
            return newCard;
          }
          return item;
        });
        if (
          found &&
          this.realmSandbox.setOpaqueRelationshipPath(
            parentCard,
            targetPath,
            replaced,
          )
        ) {
          if (parentCard.id) {
            this.store.save(parentCard.id as string);
          }
          return;
        }
      }
    }
    let containerForFields =
      targetPath && this.getWrappedInstance(targetPath, parentCard);
    let fieldContainer = containerForFields ?? parentCard;
    // Discover every declared link field, not only the ones the card has:
    // this loop locates the target field to relink, and the target is
    // typically empty at that point (the whole reason we're linking a copy
    // into it). The `usedLinksToFieldsOnly` default would omit an unset target
    // and silently skip the relink.
    let fields: Record<
      string,
      | (CardAPI.Field<CardAPI.BaseDefConstructor> & { cardRef?: CodeRef })
      | undefined
    > = cardApi.getFields(fieldContainer, {
      usedLinksToFieldsOnly: false,
      includeComputeds: false,
    });
    if (fieldContainer === parentCard) {
      for (let [name, metadata] of Object.entries(
        this.realmSandbox.introspectOpaqueCardFields(parentCard) ?? {},
      )) {
        fields[name] ??= {
          fieldType: metadata.kind,
          cardRef: {
            module: metadata.type.module,
            name: metadata.type.name,
          },
        } as CardAPI.Field<CardAPI.BaseDefConstructor> & { cardRef: CodeRef };
      }
    }

    // Note: if the parent came from a query-only stack entry, this won't link because it only patches real linksTo/linksToMany fields on a loaded parent card,
    // but the copied card is still created/added and can be used independently.
    // Only update parent relationships that are defined as fields (linksTo/linksToMany)
    for (let [fieldName, fieldDef] of Object.entries(fields)) {
      if (!fieldDef) {
        continue;
      }
      if (targetPath && fieldName !== targetPath.split('.').pop()) {
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
        !this.matchesRelationshipType(newCard, fieldDef)
      ) {
        continue;
      }
      let currentValue = (fieldContainer as any)[fieldName];
      if (fieldDef.fieldType === 'linksTo') {
        this.assignAndSave(
          parentCard,
          fieldContainer,
          targetPath ?? fieldName,
          fieldName,
          newCard,
        );
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
          this.assignAndSave(
            parentCard,
            fieldContainer,
            targetPath ?? fieldName,
            fieldName,
            replaced,
          );
          return;
        }
      }
    }
  }

  private matchesRelationshipType(
    card: CardAPI.BaseDef,
    fieldDef: CardAPI.Field<CardAPI.BaseDefConstructor> & {
      cardRef?: CodeRef;
    },
  ): boolean {
    if (fieldDef.cardRef) {
      return (
        this.realmSandbox.opaqueCardIsInstanceOf(card, fieldDef.cardRef) !==
        false
      );
    }
    if (!('card' in fieldDef) || !fieldDef.card) {
      return true;
    }
    return (
      card instanceof fieldDef.card ||
      (card as CardAPI.BaseDef).constructor?.name === fieldDef.card.name
    );
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

  private assignAndSave(
    parentCard: CardAPI.CardDef,
    targetContainer: any,
    relationshipPath: string,
    fieldName: string,
    value: unknown,
  ) {
    if (
      !this.realmSandbox.setOpaqueRelationshipPath(
        parentCard,
        relationshipPath,
        value,
      )
    ) {
      (targetContainer as any)[fieldName] = value;
    }
    if (parentCard.id) {
      this.store.save(parentCard.id as string);
    }
  }

  private findRelationshipPath(
    card: CardAPI.CardDef,
    fieldName: string,
  ): string | undefined {
    let api = this.#cardAPI;
    if (!api) {
      return undefined;
    }
    // Resolve a leaf field name to its full dotted path (e.g. `theme` ->
    // `cardInfo.theme`) by walking the declared field structure, not a
    // serialization: the target we're linking into is typically unset, so it
    // may not appear in the card's serialized relationships at all.
    let search = (
      owner: CardAPI.BaseDef | typeof CardAPI.BaseDef,
      prefix: string,
    ): string | undefined => {
      let fields: Record<string, any>;
      try {
        fields = api.getFields(owner as any, { includeComputeds: false });
      } catch {
        return undefined;
      }
      for (let [name, field] of Object.entries(fields)) {
        if (!field) {
          continue;
        }
        let path = prefix ? `${prefix}.${name}` : name;
        if (
          name === fieldName &&
          (field.fieldType === 'linksTo' || field.fieldType === 'linksToMany')
        ) {
          return path;
        }
        if (
          (field.fieldType === 'contains' ||
            field.fieldType === 'containsMany') &&
          'card' in field &&
          field.card
        ) {
          let nested = search(field.card, path);
          if (nested) {
            return nested;
          }
        }
      }
      return undefined;
    };
    return search(card, '');
  }

  // Example: dotGetter('cardInfo.theme', card) -> card.cardInfo.theme
  private dotGetter(fieldName: string, base: CardAPI.BaseDef) {
    return fieldName
      .split('.')
      .reduce(
        (memo, part) => (memo == null ? undefined : (memo as any)[part]),
        base as any,
      );
  }

  // Example: getWrappedInstance('cardInfo.theme', card) -> card.cardInfo
  private getWrappedInstance(fieldName: string, base: CardAPI.BaseDef) {
    let parts = fieldName.split('.');
    if (parts.length < 2) {
      return base;
    }
    let parentPath = parts.slice(0, parts.length - 1).join('.');
    return this.dotGetter(parentPath, base);
  }
}

// Pre-rename spellings: realm content references these classes by named
// export in imports and codeRefs, so the old names stay importable.
export { CopyAndEditTool as CopyAndEditCommand };
