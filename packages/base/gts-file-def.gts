import { TsFileDef } from './ts-file-def';

export class GtsFileDef extends TsFileDef {
  static displayName = 'GTS Module';
  static acceptTypes = '.gts';
  static validExtensions = new Set(['.gts']);
  // CS-10787: identify GTS content to markdown consumers.
  static markdownLanguage = 'gts';
}
