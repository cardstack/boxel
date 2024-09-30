import type { QueuePublisher, QueueRunner } from '../queue';
import { type SharedTests } from '../helpers';

const tests = Object.freeze({
  'it can run a job': async (assert, { publisher, runner }) => {
    let job = await publisher.publish<number>('increment', null, 5, 17);
    runner.register('increment', async (a: number) => a + 1);
    let result = await job.done;
    assert.strictEqual(result, 18);
  },

  'a job can throw an exception': async (assert, { publisher, runner }) => {
    runner.register('increment', async (a: number) => a + 1);
    runner.register('boom', async () => {
      throw new Error('boom!');
    });
    let [errorJob, nonErrorJob] = await Promise.all([
      publisher.publish<number>('boom', null, 5, null),
      publisher.publish<number>('increment', null, 5, 17),
    ]);

    // assert that the error that was thrown does not prevent subsequent jobs
    // from running
    let [errorResults, nonErrorResults] = await Promise.allSettled([
      errorJob.done,
      nonErrorJob.done,
    ]);
    if (errorResults.status === 'rejected') {
      assert.strictEqual(errorResults.reason.message, 'boom!');
    } else {
      assert.ok(false, `expected 'errorJob' to be rejected`);
    }
    if (nonErrorResults.status === 'fulfilled') {
      assert.strictEqual(nonErrorResults.value, 18);
    } else {
      assert.ok(false, `expected 'nonErrorJob' to be fulfilled`);
    }
  },

  'jobs are processed serially within a particular queue': async (
    assert,
    { publisher, runner },
  ) => {
    assert.expect(8);
    let startedCount = 0;
    let completedCount = 0;
    let count = async (expectedStartedCount: number) => {
      assert.strictEqual(
        startedCount,
        expectedStartedCount,
        `the expected started count before job run, ${expectedStartedCount}, is correct`,
      );
      assert.strictEqual(
        completedCount,
        expectedStartedCount,
        `the expected completed count before job run, ${expectedStartedCount}, is correct`,
      );
      startedCount++;
      await new Promise((r) => setTimeout(r, 500));
      completedCount++;
      assert.strictEqual(
        startedCount,
        expectedStartedCount + 1,
        `the expected started count after job run, ${expectedStartedCount}, is correct`,
      );
      assert.strictEqual(
        completedCount,
        expectedStartedCount + 1,
        `the expected completed count after job run, ${
          expectedStartedCount + 1
        }, is correct`,
      );
    };

    runner.register('count', count);
    let job1 = await publisher.publish('count', 'count-group', 5, 0);
    let job2 = await publisher.publish('count', 'count-group', 5, 1);

    await Promise.all([job2.done, job1.done]);
  },
} as SharedTests<{ publisher: QueuePublisher; runner: QueueRunner }>);

export default tests;
