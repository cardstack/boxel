import { FontDef } from './font-file-def';

// WOFF2 wraps an sfnt in a Brotli-compressed container for the web. The browser
// decodes and renders it natively, so the live specimen is unaffected — but the
// tables are Brotli-compressed with no browser-native decoder, so this is the
// one font family that indexes without name/glyph metadata. The shells degrade
// to the specimen and file identity.
export class Woff2Def extends FontDef {
  static displayName = 'WOFF2 Font';
  static acceptTypes = '.woff2,font/woff2';
}

export default Woff2Def;
