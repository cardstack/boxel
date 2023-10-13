import { tracked } from '@glimmer/tracking';

import { Resource } from 'ember-resources';

import { getAncestor, getField } from '@cardstack/runtime-common';

import {
  ModuleSyntax,
  type PossibleCardOrFieldClass,
  type BaseDeclaration,
  type ElementDeclaration,
  isInternalReference,
  isPossibleCardOrFieldClass,
} from '@cardstack/runtime-common/module-syntax';

import {
  getCardType,
  type CardType,
} from '@cardstack/host/resources/card-type';

import { Ready as ReadyFile } from '@cardstack/host/resources/file';

import { type BaseDef } from 'https://cardstack.com/base/card-api';

// an element should be (an item of focus within a module)
// - exported function or class
// - exported card or field
// - unexported card or field
// This element (in code mode) is extended to include the cardType and cardOrField
export type Element =
  | (CardOrField & Partial<PossibleCardOrFieldClass>)
  | BaseDeclaration;

export interface CardOrField {
  cardType: CardType;
  cardOrField: typeof BaseDef;
}

export function isCardOrFieldElement(
  element: Element,
): element is CardOrField & Partial<PossibleCardOrFieldClass> {
  return (
    (element as CardOrField).cardType !== undefined &&
    (element as CardOrField).cardOrField !== undefined
  );
}

interface Args {
  named: { file: ReadyFile; exportedCardsOrFields: (typeof BaseDef)[] };
}

export class InThisFileResource extends Resource<Args> {
  @tracked _elements: Element[] = [];

  get elements() {
    return this._elements;
  }

  modify(_positional: never[], named: Args['named']) {
    let { file, exportedCardsOrFields } = named;
    let moduleSyntax = new ModuleSyntax(file.content);
    let localCardsOrFields = collectLocalCardsOrFields(
      moduleSyntax,
      exportedCardsOrFields,
    );

    // This loop
    // - adds card type (not loaded tho)
    // - includes card or field
    //   - an already exported card or field
    //   - an already that was local but exported thru some relationship
    this._elements = moduleSyntax.elements.map((value) => {
      if (isPossibleCardOrFieldClass(value)) {
        const cardOrField = exportedCardsOrFields.find(
          (c) => c.name === value.localName,
        );
        if (cardOrField) {
          return {
            ...value,
            cardOrField,
            cardType: getCardType(this, () => cardOrField as typeof BaseDef),
          } as CardOrField & Partial<PossibleCardOrFieldClass>;
        } else {
          if (localCardsOrFields.has(value)) {
            let cardOrField = localCardsOrFields.get(value) as typeof BaseDef;
            return {
              ...value,
              cardOrField,
              cardType: getCardType(this, () => cardOrField),
            } as CardOrField & Partial<PossibleCardOrFieldClass>;
          }
        }
      }
      return value as BaseDeclaration;
    });
  }
}

export function inThisFileResource(
  parent: object,
  args: () => Args['named'],
): InThisFileResource {
  return InThisFileResource.from(parent, () => ({
    named: args(),
  })) as unknown as InThisFileResource;
}

function collectLocalCardsOrFields(
  moduleSyntax: ModuleSyntax,
  exportedCardsOrFields: (typeof BaseDef)[],
): Map<PossibleCardOrFieldClass, typeof BaseDef> {
  const localCardsOrFields: Map<PossibleCardOrFieldClass, typeof BaseDef> =
    new Map();
  let possibleCardsOrFields = moduleSyntax.possibleCardsOrFields;

  for (const value of moduleSyntax.elements) {
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
  value: ElementDeclaration,
  cardOrField: typeof BaseDef,
  possibleCardsOrFields: PossibleCardOrFieldClass[],
  localCardsOrFields: Map<PossibleCardOrFieldClass, typeof BaseDef>,
) {
  if (isPossibleCardOrFieldClass(value) && isInternalReference(value.super)) {
    const indexOfParent = value.super.classIndex;
    if (indexOfParent !== undefined) {
      const parentCardOrFieldClass = possibleCardsOrFields[indexOfParent];
      const parentCardOrField = getAncestor(cardOrField);

      if (parentCardOrField) {
        localCardsOrFields.set(parentCardOrFieldClass, parentCardOrField);
      }
    }
  }
}

function findLocalField(
  value: ElementDeclaration,
  cardOrField: typeof BaseDef,
  possibleCardsOrFields: PossibleCardOrFieldClass[],
  localCardsOrFields: Map<PossibleCardOrFieldClass, typeof BaseDef>,
) {
  if (isPossibleCardOrFieldClass(value)) {
    if (value.possibleFields) {
      for (const [fieldName, v] of value.possibleFields) {
        if (isInternalReference(v.card)) {
          const indexOfParentField = v.card.classIndex;
          if (indexOfParentField !== undefined) {
            const parentFieldClass = possibleCardsOrFields[indexOfParentField];
            const localName = parentFieldClass.localName;

            if (localName) {
              const field = getField(cardOrField, fieldName);
              if (field && field.card) {
                localCardsOrFields.set(parentFieldClass, field.card);
              }
            }
          }
        }
      }
    }
  }
}
