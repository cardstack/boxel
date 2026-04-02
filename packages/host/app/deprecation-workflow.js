import setupDeprecationWorkflow from 'ember-cli-deprecation-workflow';

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
  ],
});
