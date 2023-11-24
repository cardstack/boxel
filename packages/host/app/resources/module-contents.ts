import { tracked } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';

import { Resource } from 'ember-resources';

import { getAncestor, getField, isBaseDef } from '@cardstack/runtime-common';

import {
  ModuleSyntax,
  type PossibleCardOrFieldClass,
  type BaseDeclaration,
  type FunctionDeclaration,
  type ClassDeclaration,
  isInternalReference,
  isPossibleCardOrFieldClass,
  Declaration,
} from '@cardstack/runtime-common/module-syntax';

import {
  getCardType,
  type CardType,
} from '@cardstack/host/resources/card-type';

import { type Ready } from '@cardstack/host/resources/file';

import { importResource } from '@cardstack/host/resources/import';

import { type BaseDef } from 'https://cardstack.com/base/card-api';

export type CardOrFieldDeclaration = CardOrField &
  Partial<PossibleCardOrFieldClass>;

// an declaration should be (an item of focus within a module)
// - exported function or class
// - exported card or field
// - unexported card or field
// This declaration (in code mode) is extended to include the cardType and cardOrField
export type ModuleDeclaration =
  | CardOrFieldDeclaration
  | FunctionDeclaration
  | ClassDeclaration;

export interface CardOrField {
  cardType: CardType;
  cardOrField: typeof BaseDef;
}

export function isCardOrFieldDeclaration(
  declaration: ModuleDeclaration,
): declaration is CardOrFieldDeclaration {
  return (
    isClassDeclaration(declaration) &&
    (declaration as CardOrField).cardType !== undefined &&
    (declaration as CardOrField).cardOrField !== undefined
  );
}

export function isCardOrFieldSpecifier(
  declaration: ModuleDeclaration,
): declaration is CardOrFieldDeclaration {
  return (
    declaration.type === 'specifier' &&
    (declaration as CardOrField).cardType !== undefined &&
    (declaration as CardOrField).cardOrField !== undefined
  );
}

export function isFunctionDeclaration(
  declaration: ModuleDeclaration,
): declaration is FunctionDeclaration {
  return declaration.type === 'function';
}

export function isClassDeclaration(
  declaration: ModuleDeclaration,
): declaration is ClassDeclaration {
  return declaration.type === 'class';
}

interface Args {
  named: { executableFile: Ready | undefined };
}

export class ModuleContentsResource extends Resource<Args> {
  @tracked private _declarations: ModuleDeclaration[] = [];

  get isLoading() {
    return this.load.isRunning;
  }

  get declarations() {
    return this._declarations;
  }

  modify(_positional: never[], named: Args['named']) {
    let { executableFile } = named;
    if (executableFile) {
      this.load.perform(executableFile);
    } else {
      this._declarations = [];
    }
  }

  private load = restartableTask(async (executableFile: Ready) => {
    //==loading module
    let moduleResource = importResource(this, () => executableFile.url);
    await moduleResource.loaded; // we need to await this otherwise, it will go into an infinite loop
    let exportedCardsOrFields = new Map(Object.entries(moduleResource.module));

    //==building declaration structure
    // This loop
    // - adds card type (not necessarily loaded)
    // - includes card/field, either
    //   - an exported card/field
    //   - a card/field that was local but related to another card/field which was exported, e.g. inherited OR a field of the exported card/field
    let moduleSyntax = new ModuleSyntax(
      executableFile.content,
      new URL(executableFile.url),
    );
    let localCardsOrFields = collectLocalCardsOrFields(
      moduleSyntax,
      exportedCardsOrFields,
    );
    this._declarations = moduleSyntax.declarations.reduce(
      (acc: ModuleDeclaration[], value: Declaration) => {
        if (isPossibleCardOrFieldClass(value)) {
          // case where things statically look like cards or fields
          let cardOrField: typeof BaseDef | undefined;
          let foundCardOrField = exportedCardsOrFields.get(value.localName);
          if (foundCardOrField) {
            cardOrField = foundCardOrField;
          } else if (localCardsOrFields.has(value)) {
            cardOrField = localCardsOrFields.get(value) as typeof BaseDef;
          }
          if (cardOrField !== undefined) {
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
          }
        } else {
          if (localCardsOrFields.has(value)) {
            let cardOrField = localCardsOrFields.get(value) as typeof BaseDef;
            // we don't check for loader here because cards or fields not defined in module will not have a loader
            if (cardOrField) {
              return [
                ...acc,
                {
                  ...value,
                  cardOrField,
                  cardType: getCardType(this, () => cardOrField),
                } as CardOrField & Partial<PossibleCardOrFieldClass>,
              ];
            }
          } else if (value.type === 'specifier') {
            let cardOrField: typeof BaseDef | undefined;
            let foundCardOrField = exportedCardsOrFields.get(value.exportedAs);
            if (foundCardOrField) {
              cardOrField = foundCardOrField;
            }
            if (cardOrField !== undefined) {
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
            }
            // //need absolute better conditional here
            // if (value.exportedAs === 'default') {
            //   debugger;
            // }
            // let k = exportedCardsOrFields.get(value.localName);
            // if (k !== undefined) {
            //   return [
            //     ...acc,
            //     {
            //       ...value,
            //       cardOrField: k,
            //       cardType: getCardType(this, () => k as typeof BaseDef),
            //     } as CardOrField & Partial<PossibleCardOrFieldClass>,
            //   ];
            // }
          }
        }
        if (value.exportedAs !== undefined) {
          //TODO: need to refine this you are excluding classes without exported name
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
  executableFile: () => Ready | undefined,
): ModuleContentsResource {
  return ModuleContentsResource.from(parent, () => ({
    named: {
      executableFile: executableFile(),
    },
  })) as unknown as ModuleContentsResource;
}

function collectLocalCardsOrFields(
  moduleSyntax: ModuleSyntax,
  exportedCardsOrFields: any,
): Map<PossibleCardOrFieldClass, typeof BaseDef> {
  const localCardsOrFields: Map<PossibleCardOrFieldClass, typeof BaseDef> =
    new Map();
  let possibleCardsOrFields = moduleSyntax.possibleCardsOrFields;

  for (const value of moduleSyntax.declarations) {
    const cardOrField = exportedCardsOrFields.get(value.localName);

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
