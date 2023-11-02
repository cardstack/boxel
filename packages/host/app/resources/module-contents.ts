import { tracked } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';

import { Resource } from 'ember-resources';

import { getAncestor, getField, isBaseDef } from '@cardstack/runtime-common';

import {
  ModuleSyntax,
  type PossibleCardOrFieldClass,
  type BaseDeclaration,
  type Declaration,
  isInternalReference,
  isPossibleCardOrFieldClass,
} from '@cardstack/runtime-common/module-syntax';

import {
  getCardType,
  type CardType,
} from '@cardstack/host/resources/card-type';

import { Ready as ReadyFile } from '@cardstack/host/resources/file';

import {
  importResource,
  type ImportResource,
} from '@cardstack/host/resources/import';

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
  named: { executableFile: ReadyFile };
}

export class ModuleContentsResource extends Resource<Args> {
  @tracked _declarations: ModuleDeclaration[] = [];

  get isLoading() {
    return this.load.isRunning;
  }

  get declarations() {
    return this._declarations;
  }

  get hasSomeCardOrField() {
    return (
      !this.load.isRunning &&
      this.declarations.some((d) => isCardOrFieldDeclaration(d))
    );
  }

  modify(_positional: never[], named: Args['named']) {
    let { executableFile } = named;
    this.load.perform(executableFile);
  }

  private load = restartableTask(async (executableFile: ReadyFile) => {
    //==loading module
    this.moduleResource = importResource(this, () => executableFile.url);
    await this.moduleResource.loaded;
    this._url = executableFile.url;
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

    this._declarations = moduleSyntax.declarations.reduce(
      (acc: ModuleDeclaration[], value: Declaration) => {
        if (isPossibleCardOrFieldClass(value)) {
          const cardOrField = exportedCardsOrFields.find(
            (c) => c.name === value.localName,
          );
          if (cardOrField) {
            return [
              ...acc,
              {
                ...value,
                cardOrField,
                cardType: getCardType(
                  this,
                  () => cardOrField as typeof BaseDef,
                ),
              } as CardOrField & Partial<PossibleCardOrFieldClass>,
            ];
          } else {
            if (localCardsOrFields.has(value)) {
              let cardOrField = localCardsOrFields.get(value) as typeof BaseDef;
              return [
                ...acc,
                {
                  ...value,
                  cardOrField,
                  cardType: getCardType(this, () => cardOrField),
                } as CardOrField & Partial<PossibleCardOrFieldClass>,
              ];
            }
          }
        }
        if (value.exportedAs !== undefined) {
          // some classes that look like cards may still be included,
          // we should only non-card or fields which are exported
          return [...acc, { ...value } as BaseDeclaration];
        }
        return acc;
      },
      [],
    );
  });
}

export function moduleContentsResource(
  parent: object,
  args: () => Args['named'],
): ModuleContentsResource {
  return ModuleContentsResource.from(parent, () => ({
    named: args(),
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
