import type { ClassFactory } from './export-identity-plugin.ts';

// The class factories card and field modules call to make the classes they
// export, which the export-identity plugin tags on the way out of the call.
export const CLASS_FACTORIES: readonly ClassFactory[] = Object.freeze([
  ['@cardstack/base/enum', 'default'],
  ['@cardstack/catalog/fields/status/status', 'statusField'],
  ['@cardstack/catalog/fields/priority/priority', 'priorityField'],
]);

// The other spelling a module can import those factories by: the base
// realm's alias URL, which names a module the factories name by prefix. A
// compile with a virtual network canonicalizes through it instead.
const MODULE_ALIASES: readonly (readonly [alias: string, prefix: string])[] =
  Object.freeze([
    // eslint-disable-next-line @cardstack/boxel/no-url-form-base-imports -- recognizes the alias spelling of an import, to name it by prefix
    ['https://cardstack.com/base/', '@cardstack/base/'],
  ]);

export function canonicalFactoryModule(module: string): string {
  for (let [alias, prefix] of MODULE_ALIASES) {
    if (module.startsWith(alias)) {
      return prefix + module.slice(alias.length);
    }
  }
  return module;
}
