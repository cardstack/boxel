/* eslint-disable camelcase */

exports.shorthands = undefined;

// atom_html becomes a per-ancestor JSONB map (one entry per render-type key),
// exactly like embedded_html/fitted_html, so `atom + renderType` htmlQueries
// can match a prerendered candidate. Wipe the index so every realm reindexes
// and repopulates atom_html in the new map shape — a scalar '<html>' string
// can't be cast to jsonb. Mirrors the historical embedded_html migration,
// applied to both the live and working tables.
exports.up = (pgm) => {
  pgm.sql('DELETE FROM boxel_index');
  pgm.sql('DELETE FROM boxel_index_working');
  pgm.dropColumns('boxel_index', ['atom_html']);
  pgm.dropColumns('boxel_index_working', ['atom_html']);
  pgm.addColumns('boxel_index', {
    atom_html: 'jsonb',
  });
  pgm.addColumns('boxel_index_working', {
    atom_html: 'jsonb',
  });
};

exports.down = (pgm) => {
  pgm.sql('DELETE FROM boxel_index');
  pgm.sql('DELETE FROM boxel_index_working');
  pgm.dropColumns('boxel_index', ['atom_html']);
  pgm.dropColumns('boxel_index_working', ['atom_html']);
  pgm.addColumns('boxel_index', {
    atom_html: 'varchar',
  });
  pgm.addColumns('boxel_index_working', {
    atom_html: 'varchar',
  });
};
