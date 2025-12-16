import { service } from '@ember/service';
import Service from '@ember/service';

import {
  Command,
  getAncestor,
  getField,
  isBaseDef,
} from '@cardstack/runtime-common';

import {
  ModuleSyntax,
  type PossibleCardOrFieldDeclaration,
  type FunctionDeclaration,
  type ClassDeclaration,
  type Declaration,
  type Reexport,
  isInternalReference,
} from '@cardstack/runtime-common/module-syntax';

import type CardService from '@cardstack/host/services/card-service';
import type CardTypeService from '@cardstack/host/services/card-type-service';
import type { Type } from '@cardstack/host/services/card-type-service';
import type LoaderService from '@cardstack/host/services/loader-service';
import type NetworkService from '@cardstack/host/services/network';

import type { BaseDef } from 'https://cardstack.com/base/card-api';

import { loadModule } from '../resources/import';

export interface CardOrField {
  cardType: Type;
  cardOrField: typeof BaseDef;
}

export type CardOrFieldDeclaration = CardOrField &
  Partial<PossibleCardOrFieldDeclaration> & { displayName?: string };

export type CardOrFieldReexport = CardOrField &
  Reexport & {
    displayName?: string;
  };

export type CommandDeclaration = Omit<ClassDeclaration, 'type'> & {
  type: 'command';
  command: typeof Command;
};

export type ModuleDeclaration =
  | CardOrFieldDeclaration
  | CommandDeclaration
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

export function isCommandDeclaration(
  declaration: ModuleDeclaration,
): declaration is CommandDeclaration {
  return declaration.type === 'command';
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

export function findDeclarationByName(
  name: string,
  declarations: ModuleDeclaration[],
) {
  return declarations.find((dec) => {
    return dec.exportName === name || dec.localName === name;
  });
}

export default class ModuleContentsService extends Service {
  @service declare private cardTypeService: CardTypeService;
  @service declare private loaderService: LoaderService;
  @service declare private cardService: CardService;
  @service declare private network: NetworkService;

  async assemble(url: string): Promise<ModuleDeclaration[]> {
    const result = await loadModule(
      url,
      this.loaderService.loader,
      this.network.authedFetch,
    );
    const moduleUrl = new URL(url);
    let r = await this.cardService.getSource(moduleUrl);
    if (r.status !== 200) {
      throw new Error(`Failed to fetch module source from ${url}: ${r.status}`);
    }
    let source = r.content;
    let moduleSyntax = new ModuleSyntax(source, moduleUrl);
    if ('error' in result) {
      throw new Error(
        `Error loading module at ${url}: ${result.error.message}`,
      );
    }
    return this.assembleFromModuleSyntax(moduleSyntax, result.module);
  }

  async assembleFromModuleSyntax(
    moduleSyntax: ModuleSyntax,
    module: object,
  ): Promise<ModuleDeclaration[]> {
    let exportedCardsOrFields: Map<string, typeof BaseDef> =
      getExportedCardsOrFields(module);
    let exportedCommands = getExportedCommands(module);
    let localCardsOrFields = this.collectLocalCardsOrFields(
      moduleSyntax,
      exportedCardsOrFields,
    );

    let declarationPromises = moduleSyntax.declarations.map(
      async (value: Declaration) => {
        if (value.type === 'possibleCardOrField') {
          let cardOrField = value.exportName
            ? exportedCardsOrFields.get(value.exportName)
            : localCardsOrFields.get(value);
          if (cardOrField !== undefined) {
            return {
              ...value,
              cardOrField,
              cardType: await this.cardTypeService.assembleType(
                cardOrField as typeof BaseDef,
              ),
              displayName: cardOrField.displayName,
            } as CardOrFieldDeclaration;
          }
          // case where things statically look like cards or fields but are not
          if (value.exportName !== undefined) {
            let command = exportedCommands.get(value.exportName);
            if (command) {
              return asCommandDeclaration(value, command);
            }
            return {
              ...(value.super ? { super: value.super } : {}),
              localName: value.localName,
              exportName: value.exportName,
              path: value.path,
              type: 'class',
            } as ClassDeclaration;
          }
        } else if (value.type === 'reexport') {
          let cardOrField: typeof BaseDef | undefined;
          if (value.exportName) {
            let foundCardOrField = exportedCardsOrFields.get(value.exportName);
            if (foundCardOrField) {
              cardOrField = foundCardOrField;
            }
            if (cardOrField !== undefined) {
              return {
                ...value,
                cardOrField,
                cardType: await this.cardTypeService.assembleType(
                  cardOrField as typeof BaseDef,
                ),
                displayName: cardOrField.displayName,
              } as CardOrFieldReexport;
            }
          }
        } else if (value.type === 'class') {
          if (value.exportName !== undefined) {
            let command = exportedCommands.get(value.exportName);
            if (command) {
              return asCommandDeclaration(value, command);
            }
            return value as ModuleDeclaration;
          }
        } else if (value.type === 'function') {
          if (value.exportName !== undefined) {
            return value as ModuleDeclaration;
          }
        }
        return null;
      },
    );

    let resolvedDeclarations = await Promise.all(declarationPromises);
    return resolvedDeclarations.filter(
      (d: ModuleDeclaration | null): d is ModuleDeclaration => d !== null,
    );
  }

  private collectLocalCardsOrFields(
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
          this.findLocalAncestor(
            value,
            cardOrField,
            possibleCardsOrFields,
            localCardsOrFields,
          );
          this.findLocalField(
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

  private findLocalAncestor(
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
      this.findLocalAncestor(
        parentCardOrFieldClass,
        parentCardOrField,
        possibleCardsOrFields,
        localCardsOrFields,
      );
    }
  }

  private findLocalField(
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
            this.findLocalAncestor(
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
}

function getExportedCardsOrFields(module: object) {
  return new Map(
    Object.entries(module).filter(([_, declaration]) => isBaseDef(declaration)),
  );
}

function getExportedCommands(module: object) {
  return new Map(
    Object.entries(module).filter(([_, declaration]) =>
      isCommandConstructor(declaration),
    ) as [string, typeof Command][],
  );
}

function isCommandConstructor(
  declaration: unknown,
): declaration is typeof Command {
  return (
    typeof declaration === 'function' &&
    declaration.prototype instanceof Command
  );
}

function asCommandDeclaration(
  declaration: PossibleCardOrFieldDeclaration | ClassDeclaration,
  command: typeof Command,
): CommandDeclaration {
  return {
    ...('super' in declaration ? { super: declaration.super } : {}),
    localName: declaration.localName,
    exportName: declaration.exportName,
    path: declaration.path,
    type: 'command',
    command,
  };
}
