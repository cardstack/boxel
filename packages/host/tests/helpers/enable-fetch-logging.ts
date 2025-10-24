import QUnit from 'qunit';

let teardown: (() => void) | undefined;

export default function enableFetchLogging() {
  if (teardown) return;

  const originalFetch = window.fetch.bind(window);
  const seen: Array<{
    url: string;
    status?: number;
    body?: string;
    error?: Error;
  }> = [];

  window.fetch = async (...args) => {
    const request = new Request(args[0] as RequestInfo, args[1]);
    try {
      const response = await originalFetch(request);
      if (!response.ok) {
        const cloned = response.clone();
        seen.push({
          url: request.url,
          status: cloned.status,
          body: await cloned.text().catch(() => '<failed to read body>'),
        });
      }
      return response;
    } catch (error) {
      seen.push({ url: request.url, error: error as Error });
      throw error;
    }
  };

  QUnit.on('testEnd', ({ name, failed }) => {
    if (failed && seen.length) {
      console.group(`Fetch failures during "${name}"`);
      for (const entry of seen) {
        console.error(
          entry.url,
          entry.status ?? 'rejected',
          entry.error ?? entry.body,
        );
      }
      console.groupEnd();
    }
    seen.length = 0;
  });

  teardown = () => {
    window.fetch = originalFetch;
    teardown = undefined;
  };
}
