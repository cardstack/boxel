import { click, waitFor, waitUntil } from '@ember/test-helpers';

export default {
  cases: [
    {
      id: 'daily-report-dashboard',
      format: 'isolated',
      seed: async (ctx: any) => {
        let realm = ctx.catalogRealm as any;
        return {
          'Skill/daily-report-skill.json': {
            data: {
              type: 'card',
              attributes: {
                cardTitle: 'Daily Report Generation',
                cardDescription:
                  'Generates daily report output from activity logs',
                instructions:
                  'Generate a daily report from activity log cards.',
                commands: [
                  {
                    codeRef: {
                      module: '@cardstack/boxel-host/commands/write-text-file',
                      name: 'default',
                    },
                    requiresApproval: false,
                  },
                ],
              },
              meta: {
                adoptsFrom: {
                  module: 'https://cardstack.com/base/skill',
                  name: 'Skill',
                },
              },
            },
          },
          'PolicyManual/ops.json': {
            data: {
              type: 'card',
              attributes: {
                manualTitle: 'Ops Policy',
                activityLogCardType: {
                  module: `${realm.url}daily-report-dashboard/activity-log`,
                  name: 'ActivityLog',
                },
              },
              meta: {
                adoptsFrom: {
                  module: `${realm.url}daily-report-dashboard/policy-manual`,
                  name: 'PolicyManual',
                },
              },
            },
          },
          'DailyReportDashboard/ops.json': {
            data: {
              type: 'card',
              relationships: {
                policyManual: {
                  links: {
                    self: `${ctx.testRealmURL}PolicyManual/ops`,
                  },
                },
              },
              meta: {
                adoptsFrom: {
                  module: `${realm.url}daily-report-dashboard/daily-report-dashboard`,
                  name: 'DailyReportDashboard',
                },
              },
            },
          },
        };
      },
      cardURL: (ctx: any) => `${ctx.testRealmURL}DailyReportDashboard/ops`,
      test: async (_ctx: any, assert: any) => {
        await waitFor('.generate-report-button');
        assert
          .dom('.empty-state')
          .exists('dashboard starts with empty reports');
        await click('.generate-report-button');
        await waitUntil(
          () => Boolean(document.querySelector('.reports-grid')),
          {
            timeout: 10000,
          },
        );
        assert
          .dom('.empty-state')
          .doesNotExist('reports list replaces empty state');
        assert.dom('.reports-grid').exists('generated report is displayed');
      },
    },
  ],
} as any;
