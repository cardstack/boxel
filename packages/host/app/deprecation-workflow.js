import setupDeprecationWorkflow from 'ember-cli-deprecation-workflow';

setupDeprecationWorkflow({
  workflow: [
    {
      handler: 'silence',
      matchId: 'importing-inject-from-ember-service',
    },
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
  ],
});
