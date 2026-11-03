// Declares the vendored bundle's exports so a host or catalog card that reaches
// the audio waveform type-checks. Instances are opaque here: internal/media-wave.gts
// is the one importer, and its `WaveEngine` / `WaveRegion` are the typed surface
// it uses.

export declare const RegionsPlugin: {
  create(options?: Record<string, unknown>): unknown;
};

declare const WaveSurfer: {
  create(options: Record<string, unknown>): unknown;
};
export default WaveSurfer;
