import { service } from '@ember/service';
import { isTesting } from '@embroider/macros';
import { tracked } from '@glimmer/tracking';

import { task } from 'ember-concurrency';

import { Resource } from 'ember-modify-based-class-resource';

import { ModuleSyntax } from '@cardstack/runtime-common/module-syntax';

import type { Ready } from '@cardstack/host/resources/file';
import { loadModule } from '@cardstack/host/resources/import';

import type LoaderService from '@cardstack/host/services/loader-service';
import type ModuleContentsService from '@cardstack/host/services/module-contents-service';
import {
  type ModuleDeclaration,
  type CardOrFieldDeclaration,
  type CardOrFieldReexport,
  isCardOrFieldDeclaration,
  isReexportCardOrField,
} from '@cardstack/host/services/module-contents-service';
import type NetworkService from '@cardstack/host/services/network';

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
}

export class ModuleContentsResource
  extends Resource<Args>
  implements ModuleAnalysis
{
  @service declare private moduleContentsService: ModuleContentsService;
  @service declare private loaderService: LoaderService;
  @service declare private network: NetworkService;
  @tracked moduleError:
    | { type: 'runtime' | 'compile'; message: string }
    | undefined = undefined;
  private executableFile: Ready | undefined;
  @tracked private state: State | undefined = undefined;
  private onModuleEdit?: (state: State) => void;

  get isLoading() {
    return this.load.isRunning;
  }

  get declarations() {
    return this.state?.declarations || [];
  }

  modify(_positional: never[], named: Args['named']) {
    let { executableFile, onModuleEdit } = named;
    this.executableFile = executableFile;
    this.onModuleEdit = onModuleEdit;
    if (isTesting() && (globalThis as any).__disableLoaderMonitoring) {
      return;
    }
    if (this.executableFile === undefined) {
      return;
    }
    this.load.perform(this.executableFile);
  }

  private load = task(async (executableFile: Ready) => {
    const result = await loadModule(
      executableFile.url,
      this.loaderService.loader,
      this.network.authedFetch,
    );
    if ('error' in result) {
      this.moduleError = result.error;
      return;
    } else {
      //reset moduleError only upon successful load
      //this prevents unnecessary flickering of errors
      this.moduleError = undefined;
    }
    let moduleSyntax = new ModuleSyntax(
      executableFile.content,
      new URL(executableFile.url),
    );
    let declarations =
      await this.moduleContentsService.assembleFromModuleSyntax(
        moduleSyntax,
        result.module,
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
