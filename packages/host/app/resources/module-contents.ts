import { tracked } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';

import { Resource } from 'ember-resources';

import { getAncestor, getField, isBaseDef } from '@cardstack/runtime-common';

import {
  ModuleSyntax,
  type PossibleCardOrFieldDeclaration,
  type FunctionDeclaration,
  type ClassDeclaration,
  type Reexport,
  type Declaration,
  isInternalReference,
} from '@cardstack/runtime-common/module-syntax';

import {
  getCardType,
  type CardType,
} from '@cardstack/host/resources/card-type';

import { type Ready } from '@cardstack/host/resources/file';

import { importResource } from '@cardstack/host/resources/import';

import { type BaseDef } from 'https://cardstack.com/base/card-api';

interface CardOrField {
  cardType: CardType;
  cardOrField: typeof BaseDef;
}

export type CardOrFieldDeclaration = CardOrField &
  Partial<PossibleCardOrFieldDeclaration>;

export type ModuleDeclaration =
  | CardOrFieldDeclaration
  | ClassDeclaration
  | FunctionDeclaration
  | Reexport;

export function isCardOrFieldDeclaration(
  declaration: ModuleDeclaration,
): declaration is CardOrFieldDeclaration {
  return (
    declaration.type === 'possibleCardOrField' &&
    hasCardOrFieldProperties(declaration)
  );
}

export function isReexportCardOrField(
  declaration: ModuleDeclaration,
): declaration is CardOrFieldDeclaration {
  return (
    declaration.type === 'reexport' && hasCardOrFieldProperties(declaration)
  );
}

function hasCardOrFieldProperties(declaration: ModuleDeclaration) {
  return (
    (declaration as CardOrField).cardType !== undefined &&
    (declaration as CardOrField).cardOrField !== undefined
  );
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
    if (moduleResource.module === undefined) {
      return;
    }
    let exportedCardsOrFields: Map<string, typeof BaseDef> =
      getExportedCardsOrFields(moduleResource.module);

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
    this._declarations = [];
    moduleSyntax.declarations.forEach((value: Declaration) => {
      if (value.type === 'possibleCardOrField') {
        // case where things statically look like cards or fields
        let cardOrField: typeof BaseDef | undefined;
        if (value.localName) {
          let foundCardOrField = exportedCardsOrFields.get(value.localName);
          if (foundCardOrField) {
            cardOrField = foundCardOrField;
          } else if (localCardsOrFields.has(value)) {
            cardOrField = localCardsOrFields.get(value) as typeof BaseDef;
          }
          if (cardOrField !== undefined) {
            this._declarations.push({
              ...value,
              cardOrField,
              cardType: getCardType(this, () => cardOrField as typeof BaseDef),
            } as CardOrFieldDeclaration);
          }
        }
      } else if (value.type === 'reexport') {
        let cardOrField: typeof BaseDef | undefined;
        if (value.exportedAs) {
          let foundCardOrField = exportedCardsOrFields.get(value.exportedAs);
          if (foundCardOrField) {
            cardOrField = foundCardOrField;
          }
          if (cardOrField !== undefined) {
            this._declarations.push({
              ...value,
              cardOrField,
              cardType: getCardType(this, () => cardOrField as typeof BaseDef),
            } as Reexport);
          }
        }
      } else if (value.type === 'class' || value.type === 'function') {
        if (value.exportedAs !== undefined) {
          this.declarations.push(value as ModuleDeclaration);
        }
      }
    });
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

function getExportedCardsOrFields(moduleProxy: object) {
  return new Map(
    Object.entries(moduleProxy).filter(([_, declaration]) =>
      isBaseDef(declaration),
    ),
  );
}

function collectLocalCardsOrFields(
  moduleSyntax: ModuleSyntax,
  exportedCardsOrFields: any,
): Map<PossibleCardOrFieldDeclaration, typeof BaseDef> {
  const localCardsOrFields: Map<
    PossibleCardOrFieldDeclaration,
    typeof BaseDef
  > = new Map();
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
  possibleCardsOrFields: PossibleCardOrFieldDeclaration[],
  localCardsOrFields: Map<PossibleCardOrFieldDeclaration, typeof BaseDef>,
) {
  if (
    value.type === 'possibleCardOrField' &&
    isInternalReference(value.super)
  ) {
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
  possibleCardsOrFields: PossibleCardOrFieldDeclaration[],
  localCardsOrFields: Map<PossibleCardOrFieldDeclaration, typeof BaseDef>,
) {
  if (value.type === 'possibleCardOrField') {
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
