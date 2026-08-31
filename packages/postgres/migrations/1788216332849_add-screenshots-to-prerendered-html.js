/* eslint-disable camelcase */

// The declared-screenshot manifest ({name → {specHash, objectKey, …}}) the
// prerender-html pass records per row. Both tables: the working table's rows
// are promoted into the production mirror column-for-column.
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumns('prerendered_html', { screenshots: 'jsonb' });
  pgm.addColumns('prerendered_html_working', { screenshots: 'jsonb' });
};

exports.down = (pgm) => {
  pgm.dropColumns('prerendered_html', ['screenshots']);
  pgm.dropColumns('prerendered_html_working', ['screenshots']);
};
