import { FontDef } from './font-file-def';

// WOFF wraps an sfnt for the web with per-table zlib compression, which the
// browser extract pass inflates on demand — so unlike WOFF2, a WOFF indexes with
// full name/OS-2/glyph metadata.
export class WoffDef extends FontDef {
  static displayName = 'WOFF Font';
  static acceptTypes = '.woff,font/woff';
}

export default WoffDef;
