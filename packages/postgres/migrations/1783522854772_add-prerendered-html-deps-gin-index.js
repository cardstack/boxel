exports.shorthands = undefined;

// The invalidation fan-out (`itemsThatReference`) scans
// `prerendered_html.deps` with a jsonb containment predicate — the render
// channel carries dependency edges only the format renders discover (rendered
// non-searchable links, scoped-CSS artifacts of linked instances). Mirror the
// GIN indexes that back the same predicate on boxel_index(_working).
exports.up = (pgm) => {
  pgm.createIndex('prerendered_html', 'deps', { method: 'gin' });
};

exports.down = (pgm) => {
  pgm.dropIndex('prerendered_html', 'deps', { method: 'gin' });
};
