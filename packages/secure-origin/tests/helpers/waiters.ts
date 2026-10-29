import { waitForPromise } from '@ember/test-waiters';

// Test waiters for the browser work a page awaits, so `settled()` — and with
// it `render`, `click`, `fillIn` and the rest — returns only once the page has
// finished with it. The pages ship no test waiters of their own, so the tests
// put them where the work enters: the stubbed `fetch` and the file a test
// hands the page.

type Fetch = (
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
) => Promise<Response>;

// Wraps a stubbed `fetch`: `settled()` waits for each request's answer, and
// then for the page to read its body.
export function waitedFetch(stub: Fetch): typeof fetch {
  return ((input, init) =>
    waitForPromise(stub(input, init).then(waitedBody))) as typeof fetch;
}

function waitedBody(response: Response): Response {
  for (let read of ['json', 'text'] as const) {
    let original = response[read].bind(response);
    response[read] = () => waitForPromise(original());
  }
  return response;
}

// Resolves once the browser next delivers resize observations, after the
// page's own observers of `element` have heard of any change to its size:
// the browser calls observers in the order they were made, and this one is
// made after the page's. A new observer always hears of its element once, so
// this resolves at the next delivery whether or not the size changed.
export function nextResize(element: Element): Promise<void> {
  return waitForPromise(
    new Promise<void>((resolve) => {
      let observer = new ResizeObserver(() => {
        observer.disconnect();
        resolve();
      });
      observer.observe(element);
    }),
  );
}

// `settled()` waits for the page to read a file a test hands it.
export function setupWaitedFileReads(hooks: NestedHooks) {
  let original = Blob.prototype.text;
  hooks.beforeEach(function () {
    Blob.prototype.text = function (this: Blob) {
      return waitForPromise(original.call(this));
    };
  });
  hooks.afterEach(function () {
    Blob.prototype.text = original;
  });
}
