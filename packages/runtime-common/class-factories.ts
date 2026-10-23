import type { ClassFactory } from './export-identity-plugin.ts';

// The class factories card and field modules call to make the classes they
// export, which the export-identity plugin tags on the way out of the call.
export const CLASS_FACTORIES: readonly ClassFactory[] = Object.freeze([
  ['@cardstack/base/enum', 'default'],
  ['@cardstack/catalog/fields/status/status', 'statusField'],
  ['@cardstack/catalog/fields/priority/priority', 'priorityField'],
]);
