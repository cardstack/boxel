/* eslint-disable camelcase */

exports.shorthands = undefined;

// Per-row render diagnostics for the prerendered-HTML channel. The
// prerender-html visit's breakdown (launch/wait timings, render elapsed,
// per-format render timings, the visit's HTTP correlation id) rides here,
// while the index visit's breakdown rides on `boxel_index.diagnostics` — a
// row's indexing cost and its prerendering cost are independently queryable.
// For render-error rows the same payload is mirrored onto
// `error_doc.diagnostics`, matching the `boxel_index` pattern.
//
// No backfill: a row written by a fused single-visit pass carries one
// combined breakdown on `boxel_index.diagnostics`; a row this column is
// null for simply has no persisted render breakdown.

exports.up = (pgm) => {
  pgm.addColumns('prerendered_html', { diagnostics: 'jsonb' });
  pgm.addColumns('prerendered_html_working', { diagnostics: 'jsonb' });
};

exports.down = (pgm) => {
  pgm.dropColumns('prerendered_html', ['diagnostics']);
  pgm.dropColumns('prerendered_html_working', ['diagnostics']);
};
