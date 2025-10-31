import QUnit from 'qunit';

let teardown: (() => void) | undefined;

function describeError(error: unknown): string {
  if (!error) {
    return '<unknown error>';
  }

  if (error instanceof Error) {
    const segments: string[] = [`${error.name}: ${error.message}`];

    const cause = (error as { cause?: unknown }).cause;
    if (cause && typeof cause === 'object') {
      const causeObj = cause as Record<string, unknown>;
      const causeSegments: string[] = [];
      if (typeof causeObj.message === 'string') {
        causeSegments.push(causeObj.message);
      }
      if (typeof causeObj.code === 'string') {
        causeSegments.push(`code=${causeObj.code}`);
      }
      if (
        typeof causeObj.errno === 'number' ||
        typeof causeObj.errno === 'string'
      ) {
        causeSegments.push(`errno=${causeObj.errno}`);
      }
      if (typeof causeObj.syscall === 'string') {
        causeSegments.push(`syscall=${causeObj.syscall}`);
      }
      if (typeof causeObj.address === 'string') {
        causeSegments.push(`address=${causeObj.address}`);
      }
      if (
        typeof causeObj.port === 'number' ||
        (typeof causeObj.port === 'string' && causeObj.port !== '')
      ) {
        causeSegments.push(`port=${causeObj.port}`);
      }
      if (causeSegments.length > 0) {
        segments.push(`(cause: ${causeSegments.join(', ')})`);
      }
    }

    if (error.stack) {
      segments.push(`stack=${error.stack}`);
    }

    return segments.join(' ');
  }

  if (typeof error === 'object') {
    try {
      return JSON.stringify(error);
    } catch {
      return '<non-serializable error object>';
    }
  }

  return String(error);
}

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
      if (!response.ok && !(response.status >= 300 && response.status < 400)) {
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

  QUnit.on('testEnd', ({ name, status }) => {
    void originalFetch(`http://localhost:4201/fake/${name}`, {
      method: 'GET',
    }).catch(() => {});

    if (status === 'failed' && seen.length) {
      console.group(`Fetch failures during "${name}"`);
      for (const entry of seen) {
        console.error(
          entry.url,
          entry.status ?? 'rejected',
          entry.error
            ? describeError(entry.error)
            : (entry.body ?? '<empty body>'),
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
