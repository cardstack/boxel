import { ImageDef, contains, field } from './card-api';
import {
  ColorProfileField,
  ExifMetadataField,
} from './file-formats/metadata-fields';
import type { ExifCapture, ExifLocation } from './exif-meta-extractor';
import type { ExifMetadata } from './exif-meta-extractor';
import type { ImageColorProfile } from './image-color-profile';

export { ImageDef };
export default ImageDef;

// Raster images, as distinct from vector ones. The split exists to make field
// legality explicit rather than to add a rendering layer: encoded pixels have a
// bit depth, a channel count, and possibly a camera behind them, while an SVG
// has none of those — so `SvgDef` extends `ImageDef` directly and everything
// that decodes to a pixel grid extends this.
//
// These fields live here, and not on `ImageDef` in `card-api`, on purpose.
// `card-api` statically imports FileDef's format templates, so anything it
// reaches lands in the dependency graph of every card in every realm. Attaching
// image metadata one level down means only realms that actually hold image
// files pay for the metadata field modules.
export class RasterImageDef extends ImageDef {
  static displayName = 'Raster Image';

  // What the camera recorded: body, lens, exposure, and where the shutter was
  // pressed. Empty for anything generated rather than photographed, which is
  // most images in most realms.
  @field exif = contains(ExifMetadataField);

  // How the pixels are encoded, read from the container's own header. See
  // `ExifMetadataField` for why this is a sibling of `exif` rather than nested
  // inside it.
  @field colorProfile = contains(ColorProfileField);
}

// A `CodedValueField` as it arrives over the wire: the format's own code plus
// the vocabulary that names it.
interface SerializedCodedValue {
  code: string;
  scheme: string;
}

// `ColorProfileField`'s wire shape. It differs from `ImageColorProfile` in one
// place — a color space travels as a coded value, while the per-format readers
// return the bare slug — so that the readers stay free of any knowledge about
// how the field is modeled.
export interface SerializedColorProfile extends Omit<
  ImageColorProfile,
  'colorSpace'
> {
  colorSpace?: SerializedCodedValue;
}

// The attributes a raster subclass's `extractAttributes` adds on top of the base
// file identity and dimensions. Both are plain nested objects, which is how a
// contained FieldDef arrives over the wire.
export interface RasterImageAttributes {
  exif?: { capture?: ExifCapture; location?: ExifLocation };
  colorProfile?: SerializedColorProfile;
}

// Assemble the two metadata attributes from whatever the format's readers could
// determine, and omit either one entirely when they determined nothing — an
// image with no EXIF and an unreadable header should add no attributes rather
// than empty ones.
//
// EXIF's `ColorSpace` tag is folded in only as a fallback: the container header
// is the better authority, so it wins wherever it spoke.
export function rasterImageAttributes(
  exif: ExifMetadata | undefined,
  colorProfile: ImageColorProfile | undefined,
): RasterImageAttributes {
  let { colorSpace: exifColorSpace, ...cameraFacts } = exif ?? {};
  let { colorSpace: headerColorSpace, ...pixelFacts } = colorProfile ?? {};
  let colorSpace = headerColorSpace ?? exifColorSpace;
  let hasPixelFacts = Object.values(pixelFacts).some(
    (value) => value !== undefined,
  );
  return {
    ...(Object.keys(cameraFacts).length > 0 ? { exif: cameraFacts } : {}),
    ...(hasPixelFacts || colorSpace
      ? {
          colorProfile: {
            ...pixelFacts,
            ...(colorSpace
              ? { colorSpace: { code: colorSpace, scheme: 'color-space' } }
              : {}),
          },
        }
      : {}),
  };
}
