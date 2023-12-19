import { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';

import { task } from 'ember-concurrency';

import { Resource } from 'ember-resources';

import { getAncestor, getField, isBaseDef } from '@cardstack/runtime-common';

import {
  ModuleSyntax,
  type PossibleCardOrFieldDeclaration,
  type FunctionDeclaration,
  type ClassDeclaration,
  type Declaration,
  type Reexport,
  isInternalReference,
} from '@cardstack/runtime-common/module-syntax';

import {
  getCardType,
  type CardType,
} from '@cardstack/host/resources/card-type';

import { type Ready } from '@cardstack/host/resources/file';

import { importResource } from '@cardstack/host/resources/import';

import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import { type BaseDef } from 'https://cardstack.com/base/card-api';

interface CardOrField {
  cardType: CardType;
  cardOrField: typeof BaseDef;
}

export type CardOrFieldDeclaration = CardOrField &
  Partial<PossibleCardOrFieldDeclaration>;

export type CardOrFieldReexport = CardOrField & Reexport;

export type ModuleDeclaration =
  | CardOrFieldDeclaration
  | ClassDeclaration
  | FunctionDeclaration
  | CardOrFieldReexport;

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
): declaration is CardOrFieldReexport {
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
  named: {
    executableFile: Ready | undefined;
    onModuleEdit: (state: State) => void;
  };
}

export interface State {
  url?: string;
  declarations: ModuleDeclaration[];
}

export class ModuleContentsResource extends Resource<Args> {
  @service declare operatorModeStateService: OperatorModeStateService;
  @tracked moduleError:
    | { type: 'runtime' | 'compile'; message: string }
    | undefined = undefined;
  private executableFile: Ready | undefined;
  @tracked private state: State | undefined = undefined;
  private onModuleEdit?: (state: State) => void;

  get isLoading() {
    return this.load.isRunning;
  }

  // this resource is aware of loading new modules (ie it stores previous urls)
  // it has to know this to distinguish the act of editing of a file and switching between definitions
  // when editing a file we don't want to introduce loading state, whereas when switching between definitions we do
  get isLoadingNewModule() {
    return (
      (this.load.isRunning && this.executableFile?.url !== this.state?.url) ??
      false
    );
  }

  get declarations() {
    return this.state?.declarations || [];
  }

  modify(_positional: never[], named: Args['named']) {
    let { executableFile, onModuleEdit } = named;
    this.executableFile = executableFile;
    this.moduleError = undefined;
    this.onModuleEdit = onModuleEdit;
    this.load.perform(this.executableFile);
  }

  private load = task(async (executableFile: Ready | undefined) => {
    if (executableFile === undefined) {
      return;
    }
    let moduleResource = importResource(this, () => executableFile.url);
    await moduleResource.loaded; // we need to await this otherwise, it will go into an infinite loop

    this.moduleError = moduleResource.error;
    if (moduleResource.module === undefined) {
      return;
    }
    let exportedCardsOrFields: Map<string, typeof BaseDef> =
      getExportedCardsOrFields(moduleResource.module);

    let moduleSyntax = new ModuleSyntax(
      executableFile.content,
      new URL(executableFile.url),
    );
    let newState = {
      declarations: this.buildDeclarations(moduleSyntax, exportedCardsOrFields),
      url: executableFile.url,
    };

    this.updateState(newState);
  });

  private updateState(newState: State): void {
    if (newState.url === this.state?.url) {
      this.onModuleEdit?.(newState);
    }
    this.state = newState;
  }

  private buildDeclarations(
    moduleSyntax: ModuleSyntax,
    exportedCardsOrFields: Map<string, typeof BaseDef>,
  ): ModuleDeclaration[] {
    let localCardsOrFields = collectLocalCardsOrFields(
      moduleSyntax,
      exportedCardsOrFields,
    );
    let declarations: ModuleDeclaration[] = [];
    moduleSyntax.declarations.forEach((value: Declaration) => {
      if (value.type === 'possibleCardOrField') {
        let cardOrField = value.exportName
          ? exportedCardsOrFields.get(value.exportName)
          : localCardsOrFields.get(value);
        if (cardOrField !== undefined) {
          declarations.push({
            ...value,
            cardOrField,
            cardType: getCardType(this, () => cardOrField as typeof BaseDef),
          } as CardOrFieldDeclaration);
          return;
        }
        // case where things statically look like cards or fields but are not
        if (value.exportName !== undefined) {
          declarations.push({
            localName: value.localName,
            exportName: value.exportName,
            path: value.path,
            type: 'class',
          } as ClassDeclaration);
        }
      } else if (value.type === 'reexport') {
        let cardOrField: typeof BaseDef | undefined;
        if (value.exportName) {
          let foundCardOrField = exportedCardsOrFields.get(value.exportName);
          if (foundCardOrField) {
            cardOrField = foundCardOrField;
          }
          if (cardOrField !== undefined) {
            declarations.push({
              ...value,
              cardOrField,
              cardType: getCardType(this, () => cardOrField as typeof BaseDef),
            } as CardOrFieldReexport);
          }
        }
      } else if (value.type === 'class' || value.type === 'function') {
        if (value.exportName !== undefined) {
          declarations.push(value as ModuleDeclaration);
        }
      }
    });
    return declarations;
  }
}

export function moduleContentsResource(
  parent: object,
  executableFile: () => Ready | undefined,
  onModuleEdit: (state: State) => void,
): ModuleContentsResource {
  return ModuleContentsResource.from(parent, () => ({
    named: {
      executableFile: executableFile(),
      onModuleEdit: onModuleEdit,
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
  exportedCardsOrFields: Map<string, typeof BaseDef>,
): Map<PossibleCardOrFieldDeclaration, typeof BaseDef> {
  const localCardsOrFields: Map<
    PossibleCardOrFieldDeclaration,
    typeof BaseDef
  > = new Map();
  let possibleCardsOrFields = moduleSyntax.possibleCardsOrFields;

  for (const value of moduleSyntax.declarations) {
    if (value.localName !== undefined) {
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
  }

  return localCardsOrFields;
}

function findLocalAncestor(
  value: Declaration,
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
    findLocalAncestor(
      parentCardOrFieldClass,
      parentCardOrField,
      possibleCardsOrFields,
      localCardsOrFields,
    );
  }
}

function findLocalField(
  value: Declaration,
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
          findLocalAncestor(
            parentFieldClass,
            field.card,
            possibleCardsOrFields,
            localCardsOrFields,
          );
        }
      }
    }
  }
}

export function findDeclarationByName(
  name: string,
  declarations: ModuleDeclaration[],
) {
  return declarations.find((dec) => {
    return dec.exportName === name || dec.localName === name;
  });
}
