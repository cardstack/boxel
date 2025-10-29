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
  loadModule: () => Promise<CommandModule>;
}

const commandModules: CommandModuleDescriptor[] = commandModuleContext
  .keys()
  .map((fileName) => ({
    fileName,
    moduleName: moduleNameFromFileName(fileName),
    loadModule: async () => commandModuleContext(fileName) as CommandModule,
  }))
  .sort((a, b) => a.moduleName.localeCompare(b.moduleName));

export function shimHostCommands(virtualNetwork: VirtualNetwork) {
  for (let { moduleName, loadModule } of commandModules) {
    virtualNetwork.shimAsyncModule({
      id: `@cardstack/boxel-host/commands/${moduleName}`,
      resolve: loadModule,
    });
  }
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

function moduleNameFromFileName(fileName: string): string {
  return fileName.replace(/^\.\//, '').replace(/\.(?:g)?ts$/, '');
}
