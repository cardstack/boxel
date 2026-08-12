// The shape every video container's reader returns, so `MediaEncodingField` can
// be populated identically from an MP4 sample entry or a WebM track entry.
//
// Video shares `MediaEncodingField` with audio rather than getting its own: a
// container holds both streams, a bitrate means the same thing in each, and a
// file with sound has facts from both sides to report. Only the video-specific
// axes live here.
//
// Every property is optional and absence is meaningful: a container that states
// no frame rate leaves it unset rather than being given a plausible 30.

export interface VideoEncoding {
  container?: string;
  videoCodec?: string;
  audioCodec?: string;
  // Stored dimensions, before any rotation the container asks for.
  width?: number;
  height?: number;
  frameRate?: number;
  bitrateBps?: number;
  // Degrees clockwise, from the track's display matrix. A phone video is
  // routinely stored landscape with a 90-degree rotation, so ignoring this
  // reports the wrong shape for a large share of real files.
  rotationDegrees?: number;
  durationSeconds?: number;
  hasAudio?: boolean;
}

export function prunedVideoEncoding(
  candidate: VideoEncoding,
): VideoEncoding | undefined {
  let entries = Object.entries(candidate).filter(
    ([, value]) => value !== undefined,
  );
  return entries.length > 0
    ? (Object.fromEntries(entries) as VideoEncoding)
    : undefined;
}

// What a player should lay out, which is not always what the file stores. A
// quarter-turn swaps the axes, so a 1920x1080 track rotated 90 degrees presents
// as 1080x1920.
export function displayDimensions(encoding: VideoEncoding): {
  width?: number;
  height?: number;
} {
  let { width, height, rotationDegrees } = encoding;
  let quarterTurn =
    rotationDegrees !== undefined &&
    (Math.abs(rotationDegrees) === 90 || Math.abs(rotationDegrees) === 270);
  return quarterTurn ? { width: height, height: width } : { width, height };
}
