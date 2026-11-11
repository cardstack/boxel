import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import {
  automationInitiatedPriority,
  systemInitiatedPrerenderHtmlPriority,
  userInitiatedPrerenderHtmlPriority,
  userInitiatedPriority,
} from '@cardstack/runtime-common';

import { workerSpecs } from '../lib/worker-lanes.ts';

const none = {
  userIndexCount: 0,
  highPriorityCount: 0,
  automationCount: 0,
  allPriorityCount: 0,
};

module(basename(import.meta.filename), function () {
  module('workerSpecs', function () {
    test('an automation worker claims at the automation tier, across every job type', function (assert) {
      assert.deepEqual(workerSpecs({ ...none, automationCount: 2 }), [
        {
          lane: 'automation',
          priority: automationInitiatedPriority,
          indexJobsOnly: false,
        },
        {
          lane: 'automation',
          priority: automationInitiatedPriority,
          indexJobsOnly: false,
        },
      ]);
    });

    test('the automation tier sits between the system and user tiers', function (assert) {
      assert.true(
        automationInitiatedPriority > systemInitiatedPrerenderHtmlPriority,
        'an all-priority worker claims automation runs',
      );
      assert.true(
        automationInitiatedPriority < userInitiatedPrerenderHtmlPriority,
        'a high-priority worker does not claim automation runs, and an automation worker claims user-initiated jobs',
      );
    });

    test('a lane with 0 workers starts none', function (assert) {
      assert.deepEqual(workerSpecs(none), [], 'every lane at 0');
      assert.deepEqual(
        workerSpecs({ ...none, allPriorityCount: 1 }).map((s) => s.lane),
        ['all-priority'],
        'an automation lane of 0 adds nothing to the default shape',
      );
    });

    test('every lane is started, highest floor first', function (assert) {
      assert.deepEqual(
        workerSpecs({
          userIndexCount: 1,
          highPriorityCount: 1,
          automationCount: 1,
          allPriorityCount: 1,
        }),
        [
          {
            lane: 'user-index',
            priority: userInitiatedPriority,
            indexJobsOnly: true,
          },
          {
            lane: 'high-priority',
            priority: userInitiatedPrerenderHtmlPriority,
            indexJobsOnly: false,
          },
          {
            lane: 'automation',
            priority: automationInitiatedPriority,
            indexJobsOnly: false,
          },
          {
            lane: 'all-priority',
            priority: systemInitiatedPrerenderHtmlPriority,
            indexJobsOnly: false,
          },
        ],
      );
    });

    test('the worker count used for heap sizing includes the automation lane', function (assert) {
      assert.strictEqual(
        workerSpecs({
          userIndexCount: 0,
          highPriorityCount: 2,
          automationCount: 3,
          allPriorityCount: 1,
        }).length,
        6,
      );
    });
  });
});
