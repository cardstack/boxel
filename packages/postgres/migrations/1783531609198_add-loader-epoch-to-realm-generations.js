/* eslint-disable camelcase */

exports.shorthands = undefined;

// An opaque token identifying the realm's current "loader epoch": any index
// pass whose invalidation set includes executable modules mints a fresh
// token. Renders thread it into the /render route, which resets its loader
// (and held token) whenever the incoming token differs from the one it last
// cleared for — so module edits invalidate warm prerender-tab loaders
// exactly once per tab, instance-only passes leave them warm, and a
// mismatch in either direction (including a rebuilt realm whose history
// restarted) reads as stale. An opaque token rather than a number: with
// mismatch-means-clear semantics only identity matters, and numeric
// counters collide across from-scratch rebuilds where counting restarts.
// '0' is the no-epoch-yet sentinel; a fresh tab holds no epoch at all, so
// its first render mismatches and synchronizes regardless of the value.
exports.up = (pgm) => {
  pgm.addColumn('realm_generations', {
    loader_epoch: { type: 'text', notNull: true, default: '0' },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn('realm_generations', 'loader_epoch');
};
