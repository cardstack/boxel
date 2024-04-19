import { type SharedTests } from '../helpers';
import { type Queue } from '../index';

const tests = Object.freeze({
  'it can run a job': async (assert, { queue }) => {
    let job = await queue.publish<number>('increment', 17, {
      queueName: 'increment-queue',
    });
    queue.register('increment', async (a: number) => a + 1);
    let result = await job.done;
    assert.strictEqual(result, 18);
  },

  'a job can throw an exception': async (assert, { queue }) => {
    queue.register('increment', async (a: number) => a + 1);
    queue.register('boom', async () => {
      throw new Error('boom!');
    });
    let [errorJob, nonErrorJob] = await Promise.all([
      queue.publish<number>('boom', null),
      queue.publish<number>('increment', 17),
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
} as SharedTests<{ queue: Queue }>);

export default tests;
