// The classic addon package root is its Node-only Ember CLI build hook. Vite's
// production resolver does not apply the classic addon's runtime remapping, so
// importing the root bundles `index.js` and crashes in the browser while
// evaluating `window.require('./package')`. Import the addon's browser module
// explicitly; development and production then execute the same code.
import setupDeprecationWorkflow from 'ember-cli-deprecation-workflow/addon/index.js';

setupDeprecationWorkflow({
  workflow: [
    {
      handler: 'silence',
      matchId: 'deprecate-import--set-classic-decorator-from-ember',
    },
    {
      handler: 'silence',
      matchId: 'deprecate-import-view-utils-from-ember',
    },
    {
      handler: 'silence',
      matchId: 'deprecate-import-env-from-ember',
    },
    {
      handler: 'silence',
      matchId: 'deprecate-import-onerror-from-ember',
    },
    {
      handler: 'silence',
      matchId: 'deprecate-import-libraries-from-ember',
    },
    {
      handler: 'silence',
      matchId: 'importing-inject-from-ember-service',
    },
  ],
});
