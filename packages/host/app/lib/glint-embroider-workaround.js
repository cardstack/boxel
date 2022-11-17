// Glint wraps these packages but tries to use window.require to access the
// originals, which won't work under embroider with staticAddonTrees enabled.

import * as GlimmerComponent from '@glimmer/component';
window.define('@glimmer/component', function () {
  return GlimmerComponent;
});

import * as Modifier from 'ember-modifier';
window.define('ember-modifier', function () {
  return Modifier;
});
