import { logger, trimExecutableExtension } from './index';

function trimModuleIdentifier(moduleIdentifier: string): string {
  return trimExecutableExtension(new URL(moduleIdentifier)).href;
}

export const PACKAGES_FAKE_ORIGIN = 'https://packages/';

export class PackageShimHandler {
  private resolveImport: (moduleIdentifier: string) => string;
  private modules = new Map<string, Record<string, any>>();
  private log = logger('shim-handler');

  constructor(resolveImport: (moduleIdentifier: string) => string) {
    this.resolveImport = resolveImport;
  }

  handle = async (request: Request): Promise<Response | null> => {
    if (request.url.startsWith(PACKAGES_FAKE_ORIGIN)) {
      try {
        let shimmedModule = this.getModule(request.url);
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

  shimModule(moduleIdentifier: string, module: Record<string, any>) {
    moduleIdentifier = this.resolveImport(moduleIdentifier);
    this.setModule(moduleIdentifier, module);
  }

  private setModule(moduleIdentifier: string, module: Record<string, any>) {
    this.modules.set(trimModuleIdentifier(moduleIdentifier), module);
  }

  private getModule(moduleIdentifier: string): Record<string, any> | undefined {
    return this.modules.get(trimModuleIdentifier(moduleIdentifier));
  }
}
