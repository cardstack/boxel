import { VirtualNetwork } from '@cardstack/runtime-common';

import HostBaseCommand from '../lib/host-base-command';

type CommandModule = Record<string, unknown>;

declare const require: {
  context?: (
    directory: string,
    useSubdirectories: boolean,
    regExp: RegExp,
  ) => {
    keys(): string[];
    <T>(id: string): T;
  };
};

const commandModuleContext = getCommandModuleContext();

interface CommandModuleDescriptor {
  fileName: string;
  moduleName: string;
}

const commandModules: CommandModuleDescriptor[] = commandModuleContext
  .keys()
  .map((fileName) => ({
    fileName,
    moduleName: moduleNameFromFileName(fileName),
  }))
  .sort((a, b) => a.moduleName.localeCompare(b.moduleName));

const commandModuleLoaders = new Map<string, () => Promise<CommandModule>>(
  commandModules.map(({ moduleName }) => [
    moduleName,
    () => import(`./${moduleName}`),
  ]),
);

export function shimHostCommands(virtualNetwork: VirtualNetwork) {
  virtualNetwork.shimAsyncModule({
    prefix: '@cardstack/boxel-host/commands/',
    resolve: async (rest) => {
      let moduleName = normalizeRequestedModule(rest);
      let loadModule = commandModuleLoaders.get(moduleName);
      if (!loadModule) {
        throw new Error(
          `Unknown host command module "@cardstack/boxel-host/commands/${moduleName}"`,
        );
      }
      return await loadModule();
    },
  });
}

export const HostCommandClasses: (typeof HostBaseCommand<any, any>)[] =
  uniqueHostCommandClasses(
    commandModules.flatMap(({ fileName }) => {
      let moduleExports = commandModuleContext(fileName) as CommandModule;
      return extractHostCommandClasses(moduleExports);
    }),
  );

function extractHostCommandClasses(
  moduleExports: CommandModule,
): (typeof HostBaseCommand<any, any>)[] {
  return Object.keys(moduleExports)
    .sort()
    .map((exportName) => moduleExports[exportName])
    .filter(isHostCommandClass) as (typeof HostBaseCommand<any, any>)[];
}

function uniqueHostCommandClasses(
  classes: (typeof HostBaseCommand<any, any>)[],
): (typeof HostBaseCommand<any, any>)[] {
  let seen = new Set<typeof HostBaseCommand<any, any>>();
  let result: (typeof HostBaseCommand<any, any>)[] = [];
  for (let CommandClass of classes) {
    if (!seen.has(CommandClass)) {
      seen.add(CommandClass);
      result.push(CommandClass);
    }
  }
  return result;
}

function isHostCommandClass(
  value: unknown,
): value is typeof HostBaseCommand<any, any> {
  return (
    typeof value === 'function' &&
    value.prototype instanceof HostBaseCommand
  );
}

function moduleNameFromFileName(fileName: string): string {
  return fileName.replace(/^\.\//, '').replace(/\.(?:g)?ts$/, '');
}

function normalizeRequestedModule(rest: string): string {
  let sanitized = rest.replace(/^[\\/]+/, '').split(/[?#]/, 1)[0];
  if (sanitized.endsWith('/')) {
    sanitized = sanitized.slice(0, -1);
  }
  sanitized = sanitized.replace(/\.(?:g)?ts$/, '').replace(/\.js$/, '');
  if (sanitized.endsWith('/default')) {
    sanitized = sanitized.slice(0, -'/default'.length);
  }
  if (!sanitized) {
    throw new Error('Requested host command module must not be empty');
  }
  if (sanitized.includes('..')) {
    throw new Error(
      `Refusing to resolve host command module with parent traversal: "${rest}"`,
    );
  }
  if (sanitized.includes('/')) {
    throw new Error(`Unknown host command module "${rest}"`);
  }
  return sanitized;
}

function getCommandModuleContext() {
  if (typeof require?.context !== 'function') {
    throw new Error(
      "Host command loader expects webpack's require.context to be available",
    );
  }
  return require.context(
    './',
    false,
    /^\.\/(?!index)(?!.*\.d\.ts$).*\.(?:g)?ts$/,
  );
}
