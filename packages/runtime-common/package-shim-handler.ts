import { logger, trimExecutableExtension } from './index';

export type ModuleLike = Record<string, any>;
export type ModuleDescriptor =
  | { prefix: `${string}/`; resolve: (rest: string) => Promise<ModuleLike> }
  | { id: string; resolve: () => Promise<ModuleLike> };

function trimModuleIdentifier(moduleIdentifier: string): string {
  return trimExecutableExtension(new URL(moduleIdentifier)).href;
}

export const PACKAGES_FAKE_ORIGIN = 'https://packages/';

export class PackageShimHandler {
  private resolveImport: (moduleIdentifier: string) => string;
  private moduleIds = new Map<string, () => Promise<ModuleLike>>();
  private modulePrefixes = new Map<
    string,
    (rest: string) => Promise<ModuleLike>
  >();
  private log = logger('shim-handler');

  constructor(resolveImport: (moduleIdentifier: string) => string) {
    this.resolveImport = resolveImport;
  }

  handle = async (request: Request): Promise<Response | null> => {
    if (request.url.startsWith(PACKAGES_FAKE_ORIGIN)) {
      try {
        let shimmedModule =
          (await this.getModule(request.url)) ||
          (await this.getModuleByPrefix(request.url));
        if (shimmedModule) {
          let response = new Response();
          (response as any)[Symbol.for('shimmed-module')] = shimmedModule;
          return response;
        }
        return null;
      } catch (err: any) {
        this.log.error(
          `PackageShimHandler#handle threw an error handling ${request.url}`,
          err,
        );
        return null;
      }
    }
    return null;
  };

  shimModule(moduleIdentifier: string, module: ModuleLike) {
    moduleIdentifier = this.resolveImport(moduleIdentifier);
    this.moduleIds.set(
      trimModuleIdentifier(moduleIdentifier),
      async () => module,
    );
  }

  shimAsyncModule(descriptor: ModuleDescriptor) {
    if ('prefix' in descriptor) {
      this.modulePrefixes.set(
        this.resolveImport(descriptor.prefix),
        descriptor.resolve,
      );
    } else {
      this.moduleIds.set(
        trimModuleIdentifier(descriptor.id),
        descriptor.resolve,
      );
    }
  }

  private async getModule(url: string): Promise<ModuleLike | undefined> {
    let resolver = this.moduleIds.get(trimModuleIdentifier(url));
    if (resolver) {
      return await resolver();
    }
    return undefined;
  }

  private async getModuleByPrefix(
    url: string,
  ): Promise<ModuleLike | undefined> {
    for (const [modulePrefix, resolveModule] of this.modulePrefixes) {
      if (url.startsWith(modulePrefix)) {
        let rest = url.slice(modulePrefix.length);
        return await resolveModule(rest);
        break;
      }
    }
    return undefined;
  }
}
