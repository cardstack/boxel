import { click, waitFor, waitUntil } from '@ember/test-helpers';

import { module, test } from 'qunit';

import { renderCard } from '../../helpers/render-component';

import { setupCatalogIsolatedCardTest } from './setup';

module('Integration | Catalog | daily-report-dashboard', function (hooks) {
  setupCatalogIsolatedCardTest(hooks, {
    beforeEach: async function () {
      let realm = this.catalogRealm as any;
      this.catalogTestRealmContents = {
        'Skill/daily-report-skill.json': {
          data: {
            type: 'card',
            attributes: {
              cardTitle: 'Daily Report Generation',
              cardDescription:
                'Generates daily report output from activity logs',
              instructions: 'Generate a daily report from activity log cards.',
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
                  self: `${this.testRealmURL}PolicyManual/ops`,
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
  });

  test('daily-report-dashboard', async function (this: any, assert) {
    let dashboard = await this.store.get(
      `${this.testRealmURL}DailyReportDashboard/ops`,
    );
    assert.ok(dashboard, 'saved dashboard card is loaded from realm');
    await renderCard(this.loader, dashboard as any, 'isolated');
    await waitFor('.generate-report-button');
    assert.dom('.empty-state').exists('dashboard starts with empty reports');
    await click('.generate-report-button');
    await waitUntil(() => Boolean(document.querySelector('.reports-grid')), {
      timeout: 10000,
    });
    assert
      .dom('.empty-state')
      .doesNotExist('reports list replaces empty state');
    assert.dom('.reports-grid').exists('generated report is displayed');
  });
});
