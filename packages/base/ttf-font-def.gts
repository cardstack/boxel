import { FontDef } from './font-file-def';

// TrueType: a bare sfnt with `glyf` outlines. Its tables are uncompressed, so it
// indexes with the fullest metadata of the four families.
export class TtfDef extends FontDef {
  static displayName = 'TrueType Font';
  static acceptTypes = '.ttf,font/ttf';
}

export default TtfDef;
