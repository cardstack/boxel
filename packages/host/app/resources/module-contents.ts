import { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';

import { task } from 'ember-concurrency';

import { Resource } from 'ember-modify-based-class-resource';

import { ModuleSyntax } from '@cardstack/runtime-common/module-syntax';

import { type Ready } from '@cardstack/host/resources/file';

import { importResource } from '@cardstack/host/resources/import';

import ModuleContentsService, {
  type ModuleDeclaration,
  type CardOrFieldDeclaration,
  type CardOrFieldReexport,
  isCardOrFieldDeclaration,
  isReexportCardOrField,
} from '../services/module-contents-service';

export {
  isCardOrFieldDeclaration,
  isReexportCardOrField,
  type ModuleDeclaration,
  type CardOrFieldDeclaration,
  type CardOrFieldReexport,
};

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

export interface ModuleAnalysis {
  declarations: ModuleDeclaration[];
  moduleError: { type: 'runtime' | 'compile'; message: string } | undefined;
  isLoading: boolean;
  isLoadingNewModule: boolean;
}

export class ModuleContentsResource
  extends Resource<Args>
  implements ModuleAnalysis
{
  @service declare moduleContentsService: ModuleContentsService;
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
    if (!this.executableFile) {
      return false;
    }

    return this.executableFile.url !== this.state?.url;
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
    let moduleSyntax = new ModuleSyntax(
      executableFile.content,
      new URL(executableFile.url),
    );

    let declarations = await this.moduleContentsService.assembleDeclarations(
      moduleSyntax,
      moduleResource.module,
    );

    let newState = {
      declarations,
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
