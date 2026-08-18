import { byteStreamToUint8Array } from '@cardstack/runtime-common';
import TypeIcon from '@cardstack/boxel-icons/type';
import { FileDef, contains, field } from './card-api';
import type { ByteStream, SerializedFile } from './file-api';
import { FontMetadataField } from './file-formats/metadata-fields';
import { FontSpecimen } from './file-formats/font-specimen';
import { extractFontMetadata, type FontMetadata } from './font-meta-extractor';
import type { FilePreviewComponent } from './file-formats/file-preview-stage';

// The font family. Web fonts (WOFF2/WOFF) and desktop fonts (TTF/OTF) share one
// renderer and one metadata shape because, once the container is unwrapped, they
// are the same sfnt tables — so the four shared shells mount a single live
// specimen for every subclass, and only the labeled kind differs per extension.
//
// The metadata field and the specimen icon live here rather than in `card-api`
// so only realms that actually hold fonts pay for the font modules, matching how
// `ImageDef`/`AudioDef` keep their own fields off every card's dependency graph.

// A font over this size is not read for metadata: the tables that carry
// identity are tiny, but locating them can require buffering the whole file,
// and a large CJK face's outline data can run to tens of megabytes. The live
// specimen still renders — the browser streams the face itself — so the only
// thing skipped is the inspector's name/glyph facts.
const FONT_METADATA_MAX_BYTES = 24 * 1024 * 1024;

export class FontDef extends FileDef {
  static displayName = 'Font';
  static icon = TypeIcon;
  static acceptTypes = 'font/*';
  // A font served without a useful content type would otherwise route to a
  // generic profile by extension alone, so pin the family the four shells
  // present rather than depending on every instance carrying a `font/*` type.
  static fileFamily = 'font';

  // What the face says about itself, read from its own sfnt tables during the
  // extract pass. Empty for a WOFF2, whose tables are Brotli-compressed and
  // can't be read in the browser extract environment; the specimen renders
  // regardless. Surfaced by the shells as hero facts and the isolated
  // inspector's font-metadata group.
  @field fontMetadata = contains(FontMetadataField);

  // The four formats come from FileDef's shared shells; the family supplies only
  // the renderer that draws the type — a live FontFace specimen.
  static previewComponent: FilePreviewComponent = FontSpecimen;

  static async extractAttributes(
    url: string,
    getStream: () => Promise<ByteStream>,
    options: { contentHash?: string; contentSize?: number } = {},
  ): Promise<SerializedFile<{ fontMetadata?: FontMetadata }>> {
    let base = await super.extractAttributes(url, getStream, options);

    // A known oversize file skips the read entirely rather than buffering it to
    // then reject it.
    if (
      options.contentSize !== undefined &&
      options.contentSize > FONT_METADATA_MAX_BYTES
    ) {
      return base;
    }

    let bytes: Uint8Array;
    try {
      bytes = await byteStreamToUint8Array(await getStream());
    } catch {
      // A stream that won't read is not a reason to fail the whole extract; the
      // base file identity is already gathered.
      return base;
    }

    if (bytes.byteLength > FONT_METADATA_MAX_BYTES) {
      return base;
    }

    // A non-font throws `FileContentMismatchError` here, which propagates so the
    // extract framework falls back to a plain FileDef rather than indexing a
    // broken font. A real font with unreadable tables (a WOFF2) returns an empty
    // result instead, which adds no attribute rather than an empty object.
    let parsed = await extractFontMetadata(bytes);

    return {
      ...base,
      ...(Object.keys(parsed).length > 0 ? { fontMetadata: parsed } : {}),
    };
  }
}

export default FontDef;
