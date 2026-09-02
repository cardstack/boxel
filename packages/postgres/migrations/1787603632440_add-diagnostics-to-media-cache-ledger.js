exports.shorthands = undefined;

// Per-capture stage telemetry recorded by the capture that wrote the row: a
// `ScreenshotCapturePerfEvent`-shaped breakdown (queue wait, prerender
// stages, persist) — the same pattern as `boxel_index.diagnostics` /
// `prerendered_html.diagnostics`. Nullable: rows written by paths that
// record no telemetry simply lack it.

exports.up = (pgm) => {
  pgm.addColumns('media_cache_ledger', {
    diagnostics: { type: 'jsonb' },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('media_cache_ledger', ['diagnostics']);
};
