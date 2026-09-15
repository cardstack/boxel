import { FILE_META_VALUES_SYMBOL } from '@cardstack/runtime-common';
import { analyzeLatticeGtsSource } from '@cardstack/runtime-common/lattice-gts-analysis';
import { contains, field, StringField } from './card-api';
import { JsonField } from './json-field';
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

  @field latticeAnalysis = contains(JsonField);
  @field latticeAnalysisStatus = contains(StringField);

  static async extractAttributes(
    ...args: Parameters<typeof TsFileDef.extractAttributes>
  ) {
    const extracted = await super.extractAttributes(...args);
    const analysis = analyzeLatticeGtsSource(args[0], extracted.content);
    return {
      ...extracted,
      latticeAnalysisStatus: analysis.state,
      // The complete analysis belongs to this file's resource. Search can
      // filter its status without carrying the whole plan in every row.
      latticeAnalysis: null,
      [FILE_META_VALUES_SYMBOL]: { latticeAnalysis: analysis },
    };
  }
}

export default GtsFileDef;
