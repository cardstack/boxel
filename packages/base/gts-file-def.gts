import { TsFileDef } from './ts-file-def';

export class GtsFileDef extends TsFileDef {
  static displayName = 'GTS Module';
  static acceptTypes = '.gts';
  static validExtensions = new Set(['.gts']);
  // CS-10787: identify GTS content to markdown consumers.
  static markdownLanguage = 'gts';

  // Same shared shells, code renderer, and profile axes as TsFileDef; only the
  // labeled kind differs. `highlightTs` already marks up the `<template>` tags
  // GTS adds, so the inherited CodePreview renders a `.gts` file correctly.
  static fileKind = 'Glimmer TS';
}
