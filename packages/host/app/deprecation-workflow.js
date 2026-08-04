// The package root is its Node-side Ember CLI addon entry. Import the browser
// runtime explicitly so production Vite builds (including the hosted iframe
// renderer) never bundle `require('./package')` into the browser.
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
