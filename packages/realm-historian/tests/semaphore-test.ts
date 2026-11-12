import QUnit from 'qunit';
const { module, test } = QUnit;
import { Semaphore } from '../src/semaphore.ts';
import { sleep } from './helpers.ts';

module('semaphore', () => {
  test('grants as many permits at once as it has, then the rest in the order asked', async (assert) => {
    let semaphore = new Semaphore(2);
    let granted: string[] = [];
    let first = await semaphore.acquire();
    let second = await semaphore.acquire();
    let third = semaphore.acquire().then((release) => {
      granted.push('third');
      return release;
    });
    let fourth = semaphore.acquire().then((release) => {
      granted.push('fourth');
      return release;
    });
    await sleep(10);
    assert.deepEqual(granted, [], 'the third and fourth wait');

    first();
    let releaseThird = await third;
    assert.deepEqual(granted, ['third']);
    second();
    let releaseFourth = await fourth;
    assert.deepEqual(granted, ['third', 'fourth']);
    releaseThird();
    releaseFourth();
  });

  test('a permit given back twice frees one permit', async (assert) => {
    let semaphore = new Semaphore(1);
    let first = await semaphore.acquire();
    first();
    first();
    let second = await semaphore.acquire();
    let granted = false;
    let third = semaphore.acquire().then((release) => {
      granted = true;
      return release;
    });
    await sleep(10);
    assert.false(granted, 'the second give-back freed nothing');
    second();
    (await third)();
    assert.true(granted);
  });
});
