import VideoIcon from '@cardstack/boxel-icons/file-video';
import { NumberField, contains, field } from './card-api';
import { FileDef } from './file-api';
import { MediaEncodingField } from './file-formats/metadata-fields';
import { displayDimensions, type VideoEncoding } from './video-metadata';

// The video family. Like `AudioDef` it sits directly under `FileDef` and keeps
// its metadata off `card-api`'s import graph, so only realms holding video pay
// for the field modules.
//
// Dimensions live here rather than on `MediaEncodingField` because they are the
// file's own shape, the same way `ImageDef` carries width and height — a
// consumer laying out a player asks the file how big it is, not how it was
// encoded.
export class VideoDef extends FileDef {
  static displayName = 'Video';
  static icon = VideoIcon;
  static acceptTypes = 'video/*';

  @field duration = contains(NumberField);

  // As a player should lay it out: a quarter-turn rotation has already been
  // applied, so a phone video stored landscape reports its portrait shape.
  @field width = contains(NumberField);
  @field height = contains(NumberField);

  @field encoding = contains(MediaEncodingField);
}

export default VideoDef;

// A `QuantityField` as it arrives over the wire.
interface SerializedQuantity {
  value: number;
  unit?: string;
}

// `MediaEncodingField`'s wire shape for a video container. Shared with audio
// because a container holds both streams and a file with sound has facts from
// each side to report.
export interface SerializedVideoEncoding {
  container?: string;
  videoCodec?: string;
  audioCodec?: string;
  frameRate?: SerializedQuantity;
}

export interface VideoAttributes {
  duration?: number;
  width?: number;
  height?: number;
  encoding?: SerializedVideoEncoding;
}

// Project a container reading onto the fields, applying rotation so the stored
// dimensions become the presented ones.
export function videoAttributes(
  encoding: VideoEncoding | undefined,
): VideoAttributes {
  if (!encoding) {
    return {};
  }
  let { width, height } = displayDimensions(encoding);
  let serialized: SerializedVideoEncoding = {
    ...(encoding.container === undefined
      ? {}
      : { container: encoding.container }),
    ...(encoding.videoCodec === undefined
      ? {}
      : { videoCodec: encoding.videoCodec }),
    ...(encoding.audioCodec === undefined
      ? {}
      : { audioCodec: encoding.audioCodec }),
    ...(encoding.frameRate === undefined
      ? {}
      : { frameRate: { value: encoding.frameRate, unit: 'fps' } }),
  };
  return {
    ...(encoding.durationSeconds === undefined
      ? {}
      : { duration: encoding.durationSeconds }),
    ...(width === undefined ? {} : { width }),
    ...(height === undefined ? {} : { height }),
    ...(Object.keys(serialized).length > 0 ? { encoding: serialized } : {}),
  };
}
