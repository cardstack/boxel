/* eslint-disable no-undef */
/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable @typescript-eslint/no-empty-function */
const mergeTrees = require('broccoli-merge-trees');
const Plugin = require('broccoli-plugin');
const { WatchedDir } = require('broccoli-source');

class BroccoliNoOp extends Plugin {
  constructor(path) {
    super([new WatchedDir(path)]);
  }
  build() {}
}

/*
  Doesn't change your actualTree, but causes a rebuild when any of opts.watching
  trees change.

  This is helpful when your build pipeline doesn't naturally watch some
  dependencies that you're actively developing. For example, right now
  @embroider/webpack doesn't rebuild itself when non-ember libraries change.
*/
module.exports = function withSideWatch(actualTree, opts) {
  return mergeTrees([
    actualTree,
    ...opts.watching.map((w) => new BroccoliNoOp(w)),
  ]);
};
