import { buildWaiter } from '@ember/test-waiters';

/*
This class uses promises to implement a "mutex", which is a type of lock that can be used to
ensure only one block of provided async code is run at a time, and that they are run in the
order they were requested.

It uses Ember's test waiter API to ensure that tests wait for any code waiting for the lock to complete execution.

Usage example:

// Usage example
const mutex = new Mutex();

async function criticalSection(num: number) {
  await mutex.dispatch(async () => {
    await new Promise((resolve) => setTimeout(resolve, Math.random() * 100));
    console.log('Critical section ' + num);
  });
}
criticalSection(1);
criticalSection(2);
criticalSection(3);

// Output: (order is guaranteed despite the calling code not waiting to call the function three times and the random delays)
// -> Critical section 1
// -> Critical section 2
// -> Critical section 3

*/

const waiter = buildWaiter('mutex:waiter');

export default class Mutex {
  private mutex = Promise.resolve();

  // This method is private because the dispatch method is a less
  // dangerous way to use the mutex. If we encounter a situation
  // where we need to expose this method, we can do so.
  private async lock(): Promise<() => void> {
    let begin: (unlock: () => void) => void = (_unlock) => {};

    this.mutex = this.mutex.then(() => {
      return new Promise(begin);
    });

    return new Promise((res) => {
      begin = res;
    });
  }

  async dispatch<T>(fn: (() => T) | (() => Promise<T>)): Promise<T> {
    const token = waiter.beginAsync();
    const unlock = await this.lock();
    try {
      return await fn();
    } finally {
      unlock();
      waiter.endAsync(token);
    }
  }
}
