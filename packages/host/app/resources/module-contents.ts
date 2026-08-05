import { service } from '@ember/service';
import { isTesting } from '@embroider/macros';
import { tracked } from '@glimmer/tracking';

import { restartableTask, timeout } from 'ember-concurrency';

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
  type ToolDeclaration,
  isCardOrFieldDeclaration,
  isToolDeclaration,
  isComponentDeclaration,
  isReexportCardOrField,
} from '@cardstack/host/services/module-contents-service';
import type NetworkService from '@cardstack/host/services/network';

export {
  isCardOrFieldDeclaration,
  isToolDeclaration,
  isComponentDeclaration,
  isReexportCardOrField,
  type ModuleDeclaration,
  type CardOrFieldDeclaration,
  type CardOrFieldReexport,
  type ToolDeclaration,
};

interface Args {
  named: {
    executableFile: Ready | undefined;
    isCanonical: boolean | undefined;
    onModuleEdit: (state: State) => void;
  };
}

export interface State {
  url?: string;
  declarations: ModuleDeclaration[];
}

export interface ModuleAnalysis {
  declarations: ModuleDeclaration[];
  moduleError:
    | {
        type: 'runtime' | 'compile';
        message: string;
        status?: number;
      }
    | undefined;
  isLoading: boolean;
}

const newlyCreatedModuleVisibilityWindowMs = 90_000;

export class ModuleContentsResource
  extends Resource<Args>
  implements ModuleAnalysis
{
  @service declare private moduleContentsService: ModuleContentsService;
  @service declare private loaderService: LoaderService;
  @service declare private network: NetworkService;
  @tracked moduleError:
    | { type: 'runtime' | 'compile'; message: string; status?: number }
    | undefined = undefined;
  private executableFile: Ready | undefined;
  private isCanonical: boolean | undefined;
  @tracked private state: State | undefined = undefined;
  private onModuleEdit?: (state: State) => void;
  private loadGeneration = 0;

  get isLoading() {
    return this.load.isRunning || this.isCanonical === false;
  }

  get declarations() {
    return this.state?.declarations || [];
  }

  modify(_positional: never[], named: Args['named']) {
    let generation = ++this.loadGeneration;
    let { executableFile, isCanonical, onModuleEdit } = named;
    this.executableFile = executableFile;
    this.isCanonical = isCanonical;
    this.onModuleEdit = onModuleEdit;
    if (isTesting() && (globalThis as any).__disableLoaderMonitoring) {
      return;
    }
    if (this.executableFile === undefined) {
      return;
    }
    // A newly-created source can be edited immediately from its acknowledged
    // response body, but its extensionless executable URL is not guaranteed
    // to be visible on another hosted node until the realm index event. Keep
    // Monaco mounted and defer semantic/module evaluation until that explicit
    // acknowledgement instead of caching a transient 404 as a compile error.
    if (this.isCanonical === false) {
      return;
    }
    this.load.perform(this.executableFile, generation);
  }

  private load = restartableTask(
    async (executableFile: Ready, generation: number) => {
      let retryDeadline = Date.now() + newlyCreatedModuleVisibilityWindowMs;
      let retryDelay = 50;
      let loadCurrentGeneration = async () => {
        let result = await loadModule(
          executableFile.url,
          this.loaderService.loader,
          this.network.authedFetch,
        );
        if (
          generation !== this.loadGeneration ||
          this.executableFile !== executableFile
        ) {
          return undefined;
        }
        return result;
      };
      let result = await loadCurrentGeneration();
      if (!result) {
        return;
      }
      while (
        'error' in result &&
        executableFile.isNewlyCreated &&
        result.error.status === 404 &&
        Date.now() < retryDeadline
      ) {
        // The creation POST and index acknowledgement can be observed before
        // every hosted serving node exposes the executable module. Loader
        // deliberately does not retain failed fetches, but invalidate the
        // shared spelling explicitly before selecting another node.
        this.loaderService.loader.invalidateModule(executableFile.url);
        await timeout(retryDelay);
        retryDelay = Math.min(retryDelay * 2, 1_000);
        result = await loadCurrentGeneration();
        if (!result) {
          return;
        }
      }
      if ('error' in result) {
        this.moduleError = result.error;
        return;
      }
      // Reset moduleError only upon successful load. This prevents ordinary
      // edits from flickering errors and lets a new stub reveal main's normal
      // schema, preview, and spec panes as soon as its module is visible.
      this.moduleError = undefined;
      let moduleSyntax = new ModuleSyntax(
        executableFile.content,
        executableFile.url,
        this.network.virtualNetwork,
      );
      let declarations =
        await this.moduleContentsService.assembleFromModuleSyntax(
          moduleSyntax,
          result.module,
        );
      if (
        generation !== this.loadGeneration ||
        this.executableFile !== executableFile
      ) {
        return;
      }
      let newState = {
        declarations,
        url: executableFile.url,
      };

      this.updateState(newState);
    },
  );

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
      // FileResource is a stable resource proxy. Pass its tracked readiness
      // value separately so this resource is invalidated when an acknowledged
      // create becomes canonical even though the proxy identity is unchanged.
      isCanonical: executableFile()?.isCanonical,
      onModuleEdit: onModuleEdit,
    },
  })) as unknown as ModuleContentsResource;
}
