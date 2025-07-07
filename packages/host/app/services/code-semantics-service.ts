import Service from '@ember/service';
import { inject as service } from '@ember/service';

import {
  ResolvedCodeRef,
  hasExecutableExtension,
  identifyCard,
  isCardDocumentString,
  isResolvedCodeRef,
} from '@cardstack/runtime-common';

import { isReady } from '@cardstack/host/resources/file';

import { type Ready } from '../resources/file';

import {
  moduleContentsResource,
  type State,
  type ModuleDeclaration,
  findDeclarationByName,
  isCardOrFieldDeclaration,
} from '../resources/module-contents';

import type OperatorModeStateService from './operator-mode-state-service';

export default class CodeSemanticsService extends Service {
  @service declare operatorModeStateService: OperatorModeStateService;

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
        isLoadingNewModule: false,
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

  getIsLoadingNewModule(file: Ready | undefined, isModule: boolean): boolean {
    if (!isModule) return false;
    let resource = this.getResourceForFile(file);
    return resource.isLoadingNewModule;
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
    return (
      this.isReady &&
      hasExecutableExtension(this.readyFile.url) &&
      !this.isIncompatibleFile
    );
  }

  get isReady() {
    return isReady(this.currentOpenFile);
  }

  get isIncompatibleFile() {
    return this.readyFile.isBinary || this.isNonCardJson;
  }

  private get isNonCardJson() {
    return (
      this.readyFile.name.endsWith('.json') &&
      !isCardDocumentString(this.readyFile.content)
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
}
