import { tracked } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';

import { Resource } from 'ember-resources';

import { getAncestor, getField, isBaseDef } from '@cardstack/runtime-common';

import { Loader } from '@cardstack/runtime-common/loader';

import {
  ModuleSyntax,
  type PossibleCardOrFieldClass,
  type BaseDeclaration,
  isInternalReference,
  isPossibleCardOrFieldClass,
} from '@cardstack/runtime-common/module-syntax';

import {
  getCardType,
  type CardType,
} from '@cardstack/host/resources/card-type';

import { type Ready } from '@cardstack/host/resources/file';

import { importResource } from '@cardstack/host/resources/import';

import { type BaseDef } from 'https://cardstack.com/base/card-api';

// an declaration should be (an item of focus within a module)
// - exported function or class
// - exported card or field
// - unexported card or field
// This declaration (in code mode) is extended to include the cardType and cardOrField
export type ModuleDeclaration =
  | (CardOrField & Partial<PossibleCardOrFieldClass>)
  | BaseDeclaration;

export interface CardOrField {
  cardType: CardType;
  cardOrField: typeof BaseDef;
}

export function isCardOrFieldDeclaration(
  declaration: ModuleDeclaration,
): declaration is CardOrField & Partial<PossibleCardOrFieldClass> {
  return (
    (declaration as CardOrField).cardType !== undefined &&
    (declaration as CardOrField).cardOrField !== undefined
  );
}

interface Args {
  named: { executableFile: Ready };
}

export class ModuleContentsResource extends Resource<Args> {
  @tracked private _declarations: ModuleDeclaration[] = [];
  private moduleResource: ImportResource;

  get isLoading() {
    return this.load.isRunning;
  }

  get declarations() {
    return this._declarations;
  }

  modify(_positional: never[], named: Args['named']) {
    let { executableFile } = named;
    this.moduleResource = importResource(this, () => executableFile.url);
    this.load.perform(executableFile);
  }

  private load = restartableTask(async (executableFile: Ready) => {
    //==loading module
    await this.moduleResource.loaded; // we need to await this otherwise, it will go into an infinite loop
    let exportedCardsOrFields = Object.values(
      this.moduleResource?.module || {},
    ).filter(isBaseDef);

    //==building declaration structure
    // This loop
    // - adds card type (not necessarily loaded)
    // - includes card/field, either
    //   - an exported card/field
    //   - a card/field that was local but related to another card/field which was exported, e.g. inherited OR a field of the exported card/field
    let moduleSyntax = new ModuleSyntax(executableFile.content);
    let localCardsOrFields = collectLocalCardsOrFields(
      moduleSyntax,
      exportedCardsOrFields,
    );

    let results = [];
    for (const value of moduleSyntax.declarations) {
      if (isPossibleCardOrFieldClass(value)) {
        const cardOrField = exportedCardsOrFields.find(
          (c) => c.name === value.localName,
        );
        let loader = Loader.getLoaderFor(cardOrField);
        if (cardOrField && loader) {
          let cardType = await getCardType(
            this,
            () => cardOrField,
            () => loader,
          );
          results.push({
            ...value,
            cardOrField,
            cardType,
          } as CardOrField & Partial<PossibleCardOrFieldClass>);
        } else if (localCardsOrFields.has(value)) {
          let cardOrField = localCardsOrFields.get(value) as typeof BaseDef;
          let loader = Loader.getLoaderFor(cardOrField);
          if (cardOrField && loader) {
            let cardType = await getCardType(
              this,
              () => cardOrField,
              () => loader,
            );
            results.push({
              ...value,
              cardOrField,
              cardType,
            } as CardOrField & Partial<PossibleCardOrFieldClass>);
          }
        }
      } else if (value.exportedAs !== undefined) {
        // some classes that look like cards may still be included,
        // we should only non-card or fields which are exported
        results.push({ ...value } as BaseDeclaration);
      }
    }
    this._declarations = results;
  });
}

export function moduleContentsResource(
  parent: object,
  executableFile: () => Ready,
): ModuleContentsResource {
  return ModuleContentsResource.from(parent, () => ({
    named: {
      executableFile: executableFile(),
    },
  })) as unknown as ModuleContentsResource;
}

function collectLocalCardsOrFields(
  moduleSyntax: ModuleSyntax,
  exportedCardsOrFields: (typeof BaseDef)[],
): Map<PossibleCardOrFieldClass, typeof BaseDef> {
  const localCardsOrFields: Map<PossibleCardOrFieldClass, typeof BaseDef> =
    new Map();
  let possibleCardsOrFields = moduleSyntax.possibleCardsOrFields;

  for (const value of moduleSyntax.declarations) {
    const cardOrField = exportedCardsOrFields.find(
      (c) => c.name === value.localName,
    );

    if (cardOrField !== undefined) {
      findLocalAncestor(
        value,
        cardOrField,
        possibleCardsOrFields,
        localCardsOrFields,
      );
      findLocalField(
        value,
        cardOrField,
        possibleCardsOrFields,
        localCardsOrFields,
      );
    }
  }

  return localCardsOrFields;
}

function findLocalAncestor(
  value: ModuleDeclaration,
  cardOrField: typeof BaseDef,
  possibleCardsOrFields: PossibleCardOrFieldClass[],
  localCardsOrFields: Map<PossibleCardOrFieldClass, typeof BaseDef>,
) {
  if (isPossibleCardOrFieldClass(value) && isInternalReference(value.super)) {
    const indexOfParent = value.super.classIndex;
    if (indexOfParent === undefined) return;
    const parentCardOrFieldClass = possibleCardsOrFields[indexOfParent];
    const parentCardOrField = getAncestor(cardOrField);

    if (parentCardOrField == undefined) return;
    localCardsOrFields.set(parentCardOrFieldClass, parentCardOrField);
  }
}

function findLocalField(
  value: ModuleDeclaration,
  cardOrField: typeof BaseDef,
  possibleCardsOrFields: PossibleCardOrFieldClass[],
  localCardsOrFields: Map<PossibleCardOrFieldClass, typeof BaseDef>,
) {
  if (isPossibleCardOrFieldClass(value)) {
    if (value.possibleFields) {
      for (const [fieldName, v] of value.possibleFields) {
        if (isInternalReference(v.card)) {
          const indexOfParentField = v.card.classIndex;
          if (indexOfParentField === undefined) return;
          const parentFieldClass = possibleCardsOrFields[indexOfParentField];
          const localName = parentFieldClass.localName;

          if (localName === undefined) return;
          const field = getField(cardOrField, fieldName);
          if (field === undefined || field.card === undefined) return;
          localCardsOrFields.set(parentFieldClass, field.card);
        }
      }
    }
  }
}
