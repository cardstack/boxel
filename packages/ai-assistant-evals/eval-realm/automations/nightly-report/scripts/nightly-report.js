/* global realm */
realm.progress.plan(['Count open tasks', 'Write report']);
realm.progress.milestone('Count open tasks');
const found = await realm.cards.search({
  filter: { eq: { status: 'open' } },
});
realm.progress.task(`Found ${found.total} open tasks`);
realm.progress.milestone('Write report');
await realm.fs.writeText(
  'automations/nightly-report/report.md',
  `# Open tasks\n\n${found.total} open tasks on ${realm.current.automation.scheduledAt}\n`,
);
realm.progress.task('Wrote automations/nightly-report/report.md');
