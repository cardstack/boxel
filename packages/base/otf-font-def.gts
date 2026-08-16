import { FontDef } from './font-file-def';

// OpenType: a bare sfnt with `CFF `/`CFF2` PostScript outlines (the `OTTO`
// flavor). Same uncompressed tables as TrueType, so it too indexes with full
// metadata; only the outline technology differs.
export class OtfDef extends FontDef {
  static displayName = 'OpenType Font';
  static acceptTypes = '.otf,font/otf';
}

export default OtfDef;
