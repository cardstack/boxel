import { buildWaiter } from '@ember/test-waiters';

/* Usage example:

// Usage example
const mutex = new Mutex();

async function criticalSection() {
  await mutex.dispatch(async () => {
    // Your critical section code here
    console.log('Critical section');
  });
}
*/

const waiter = buildWaiter('mutex:waiter');

export default class Mutex {
  private mutex = Promise.resolve();

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
