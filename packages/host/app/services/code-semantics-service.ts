import Service from '@ember/service';
import { inject as service } from '@ember/service';

import type { ResolvedCodeRef, CodeRef } from '@cardstack/runtime-common';
import {
  hasExecutableExtension,
  identifyCard,
  isCardDocumentString,
  isResolvedCodeRef,
  loadCardDef,
  getAncestor,
  isCardDef as isCardDefHelper,
  isFieldDef as isFieldDefHelper,
  getField,
} from '@cardstack/runtime-common';

import { isReady } from '@cardstack/host/resources/file';

import type { BaseDef } from 'https://cardstack.com/base/card-api';

import {
  moduleContentsResource,
  type State,
  type ModuleDeclaration,
  isCardOrFieldDeclaration,
} from '../resources/module-contents';
import { findDeclarationByName } from '../services/module-contents-service';

import type LoaderService from './loader-service';
import type OperatorModeStateService from './operator-mode-state-service';
import type { Ready } from '../resources/file';

export default class CodeSemanticsService extends Service {
  @service declare operatorModeStateService: OperatorModeStateService;
  @service declare loaderService: LoaderService;

  private onModuleEditCallback: ((state: State) => void) | undefined =
    undefined;

  // Cache the resource for each unique file
  private resourceCache = new WeakMap<
    Ready,
    ReturnType<typeof moduleContentsResource>
  >();

  private getResourceForFile(file: Ready | undefined) {
    if (!file) {
      // Return a dummy resource for undefined file
      return {
        declarations: [],
        moduleError: undefined,
        isLoading: false,
      };
    }

    if (this.resourceCache.has(file)) {
      return this.resourceCache.get(file)!;
    }

    let resource = moduleContentsResource(
      this,
      () => file,
      (newState: State) => this.handleModuleEdit(newState),
    );

    this.resourceCache.set(file, resource);
    return resource;
  }

  getDeclarations(
    file: Ready | undefined,
    isModule: boolean,
  ): ModuleDeclaration[] {
    if (!isModule) return [];
    let resource = this.getResourceForFile(file);
    return resource.declarations;
  }

  getModuleError(file: Ready | undefined, isModule: boolean) {
    if (!isModule) return undefined;
    let resource = this.getResourceForFile(file);
    return resource.moduleError;
  }

  getIsLoading(file: Ready | undefined, isModule: boolean): boolean {
    if (!isModule) return false;
    let resource = this.getResourceForFile(file);
    return resource.isLoading;
  }

  getSelectedDeclaration(
    file: Ready | undefined,
    codeSelection: string | undefined,
    isModule: boolean,
  ): ModuleDeclaration | undefined {
    if (!isModule) return undefined;
    let resource = this.getResourceForFile(file);
    if (resource.moduleError) return undefined;

    let declarations = resource.declarations;
    let found = codeSelection
      ? findDeclarationByName(codeSelection, declarations)
      : undefined;
    // note: module inspector tools are not available for module with 0 exported declarations
    // if not found, default to the last declaration in the module
    return found ?? declarations[declarations.length - 1];
  }

  setOnModuleEditCallback(callback: (state: State) => void) {
    this.onModuleEditCallback = callback;
  }

  private handleModuleEdit(newState: State) {
    this.onModuleEditCallback?.(newState);
  }

  get currentOpenFile() {
    return this.operatorModeStateService.openFile.current;
  }

  get readyFile() {
    if (isReady(this.currentOpenFile)) {
      return this.currentOpenFile;
    }
    throw new Error(
      `cannot access file contents ${this.codePath} before file is open`,
    );
  }

  get codePath() {
    return this.operatorModeStateService.state.codePath;
  }

  get isModule() {
    return this.isReady && hasExecutableExtension(this.readyFile.url);
  }

  get isReady() {
    return isReady(this.currentOpenFile);
  }

  get isIncompatibleFile() {
    return this.readyFile.isBinary || (!this.isModule && this.isNonCardJson);
  }

  private get isNonCardJson() {
    return !(
      this.readyFile.name.endsWith('.json') &&
      isCardDocumentString(this.readyFile.content)
    );
  }

  get declarations() {
    return this.getDeclarations(
      this.isModule ? this.readyFile : undefined,
      this.isModule,
    );
  }

  get selectedDeclaration() {
    return this.getSelectedDeclaration(
      this.isModule ? this.readyFile : undefined,
      this.operatorModeStateService.state.codeSelection,
      this.isModule,
    );
  }

  get selectedCardOrField() {
    if (
      this.selectedDeclaration !== undefined &&
      isCardOrFieldDeclaration(this.selectedDeclaration)
    ) {
      return this.selectedDeclaration;
    }
    return undefined;
  }

  get selectedCodeRef(): ResolvedCodeRef | undefined {
    let codeRef = identifyCard(this.selectedCardOrField?.cardOrField);
    return isResolvedCodeRef(codeRef) ? codeRef : undefined;
  }

  async getInheritanceChain(): Promise<
    { codeRef: CodeRef; fields: string[] }[] | undefined
  > {
    if (!this.selectedCodeRef) {
      return undefined;
    }
    try {
      // Load the card definition to check if it's a CardDef or FieldDef descendant
      let cardOrField = await loadCardDef(this.selectedCodeRef, {
        loader: this.loaderService.loader,
        relativeTo: this.codePath || undefined,
      });

      // Check if it's a CardDef or FieldDef (or descendant)
      let isCardDef = isCardDefHelper(cardOrField);
      let isFieldDef = isFieldDefHelper(cardOrField);

      if (!isCardDef && !isFieldDef) {
        return undefined;
      }

      let inheritanceChain: { codeRef: CodeRef; fields: string[] }[] = [];
      let currentCard = cardOrField;

      // Build the inheritance chain by walking up the prototype chain
      // Stop when we reach CardDef or FieldDef (don't include BaseDef)
      while (currentCard) {
        let codeRef = identifyCard(currentCard);
        if (codeRef) {
          // Get fields defined at this level of the inheritance chain
          let fields = this.getOwnFields(currentCard);

          inheritanceChain.push({
            codeRef,
            fields,
          });
        }

        // Stop if we've reached CardDef or FieldDef
        if (
          (isCardDefHelper(currentCard) && currentCard.name === 'CardDef') ||
          (isFieldDefHelper(currentCard) && currentCard.name === 'FieldDef')
        ) {
          break;
        }

        // Get the parent (ancestor) card
        let ancestor = getAncestor(currentCard);
        if (ancestor && ancestor !== currentCard) {
          currentCard = ancestor;
        } else {
          break;
        }
      }

      return inheritanceChain.length > 0 ? inheritanceChain : undefined;
    } catch (error) {
      console.warn('Failed to build inheritance chain:', error);
      return undefined;
    }
  }

  private getOwnFields(card: typeof BaseDef): string[] {
    // Get own property descriptors to only get fields defined at this level
    let fields: string[] = [];
    let obj = card.prototype;

    if (obj) {
      let descs = Object.getOwnPropertyDescriptors(obj);
      for (let fieldName of Object.keys(descs)) {
        if (fieldName === 'constructor') {
          continue;
        }

        // Check if this is actually a field by trying to get it
        try {
          let maybeField = getField(card, fieldName);
          if (
            maybeField &&
            !maybeField.computeVia &&
            !maybeField.queryDefinition
          ) {
            fields.push(fieldName);
          }
        } catch {
          // If getField throws, it's not a valid field
          continue;
        }
      }
    }

    return fields;
  }
}
