import { TsFileDef } from './ts-file-def';

export class GtsFileDef extends TsFileDef {
  static displayName = 'GTS Module';
  static acceptTypes = '.gts';
  static validExtensions = new Set(['.gts']);
}
