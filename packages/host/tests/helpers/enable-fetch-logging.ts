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

type ResourceFailure =
  | {
      kind: 'resource';
      tagName: string;
      url?: string;
      message?: string;
      filename?: string;
      lineno?: number;
      colno?: number;
      error?: unknown;
    }
  | {
      kind: 'global';
      message?: string;
      filename?: string;
      lineno?: number;
      colno?: number;
      error?: unknown;
    };

function resourceUrlFromElement(element: Element): string | undefined {
  if (element instanceof HTMLScriptElement) {
    return element.src || element.getAttribute('src') || undefined;
  }
  if (element instanceof HTMLLinkElement) {
    return element.href || element.getAttribute('href') || undefined;
  }
  if (element instanceof HTMLImageElement) {
    return (
      element.currentSrc ||
      element.src ||
      element.getAttribute('src') ||
      undefined
    );
  }
  if (element instanceof HTMLIFrameElement) {
    return element.src || element.getAttribute('src') || undefined;
  }
  if (element instanceof HTMLSourceElement) {
    return (
      element.src ||
      element.srcset ||
      element.getAttribute('src') ||
      element.getAttribute('srcset') ||
      undefined
    );
  }
  if (element instanceof HTMLMediaElement) {
    return (
      element.currentSrc ||
      element.src ||
      element.getAttribute('src') ||
      undefined
    );
  }

  return (
    element.getAttribute('src') || element.getAttribute('href') || undefined
  );
}

function formatLocation(failure: {
  filename?: string;
  lineno?: number;
  colno?: number;
}) {
  if (!failure.filename) {
    return undefined;
  }

  let location = failure.filename;
  if (typeof failure.lineno === 'number' && failure.lineno > 0) {
    location += `:${failure.lineno}`;
    if (typeof failure.colno === 'number' && failure.colno > 0) {
      location += `:${failure.colno}`;
    }
  }

  return location;
}

export default function enableFetchLogging() {
  if (teardown) return;

  const originalFetch = window.fetch.bind(window);
  const seen: Array<{
    url: string;
    method: string;
    status?: number;
    body?: string;
    error?: Error;
  }> = [];

  const resourceFailures: ResourceFailure[] = [];
  const resourceFailureKeys = new Set<string>();
  const unhandledRejections: Array<{ reason: unknown }> = [];

  const recordResourceFailure = (failure: ResourceFailure) => {
    const keyParts =
      failure.kind === 'resource'
        ? [
            failure.kind,
            failure.tagName,
            failure.url ?? '',
            failure.message ?? '',
            failure.filename ?? '',
            failure.lineno ?? '',
            failure.colno ?? '',
          ]
        : [
            failure.kind,
            failure.message ?? '',
            failure.filename ?? '',
            failure.lineno ?? '',
            failure.colno ?? '',
          ];

    const key = keyParts.join('|');
    if (resourceFailureKeys.has(key)) {
      return;
    }

    resourceFailureKeys.add(key);
    resourceFailures.push(failure);
  };

  const flushDiagnostics = (context: string) => {
    if (seen.length) {
      console.group(`Fetch failures ${context}`);
      for (const entry of seen) {
        const prefix = `${entry.method} ${entry.url}`;
        if (entry.error) {
          console.error(prefix, describeError(entry.error));
        } else {
          console.error(
            prefix,
            entry.status ?? 'rejected',
            entry.body ?? '<empty body>',
          );
        }
      }
      console.groupEnd();
    }

    if (resourceFailures.length) {
      console.group(`Resource load failures ${context}`);
      for (const failure of resourceFailures) {
        const segments: string[] = [];
        if (failure.kind === 'resource') {
          segments.push(`<${failure.tagName.toLowerCase()}>`);
          if (failure.url) {
            segments.push(failure.url);
          }
        } else {
          segments.push('global error');
        }

        if (failure.message) {
          segments.push(`message=${failure.message}`);
        }

        const location = formatLocation(failure);
        if (location) {
          segments.push(`at ${location}`);
        }

        if (failure.error) {
          segments.push(describeError(failure.error));
        }

        console.error(segments.join(' | '));
      }
      console.groupEnd();
    }

    if (unhandledRejections.length) {
      console.group(`Unhandled promise rejections ${context}`);
      for (const rejection of unhandledRejections) {
        console.error(describeError(rejection.reason));
      }
      console.groupEnd();
    }
  };

  const clearDiagnostics = () => {
    seen.length = 0;
    resourceFailures.length = 0;
    resourceFailureKeys.clear();
    unhandledRejections.length = 0;
  };

  const describeRequest = (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): { url: string; method: string } => {
    let url: string;
    let method: string | undefined;

    if (typeof Request !== 'undefined' && input instanceof Request) {
      url = input.url;
      method = input.method;
    } else if (input instanceof URL) {
      url = input.href;
    } else if (typeof input === 'string') {
      url = input;
    } else {
      try {
        url = String(input);
      } catch {
        url = '<unknown request>';
      }
    }

    if (init?.method) {
      method = init.method;
    }

    if (!method) {
      method = 'GET';
    }

    return { url, method: method.toUpperCase() };
  };

  window.fetch = async (...args) => {
    const [input, init] = args as [RequestInfo | URL, RequestInit?];
    const { url, method } = describeRequest(input, init);
    try {
      const response =
        init === undefined
          ? await originalFetch(input as RequestInfo)
          : await originalFetch(input as RequestInfo, init as RequestInit);
      if (!response.ok && !(response.status >= 300 && response.status < 400)) {
        const cloned = response.clone();
        seen.push({
          url,
          method,
          status: cloned.status,
          body: await cloned.text().catch(() => '<failed to read body>'),
        });
      }
      return response;
    } catch (error) {
      seen.push({
        url,
        method,
        error: error as Error,
      });
      throw error;
    }
  };

  const resourceErrorHandler = (event: Event) => {
    if (!('target' in event)) {
      return;
    }

    const target = event.target as EventTarget | null;
    if (target && target !== window && target instanceof Element) {
      const failure: ResourceFailure = {
        kind: 'resource',
        tagName: target.tagName,
        url: resourceUrlFromElement(target),
      };

      if (event instanceof ErrorEvent) {
        failure.message = event.message;
        failure.filename = event.filename || undefined;
        failure.lineno = event.lineno || undefined;
        failure.colno = event.colno || undefined;
        failure.error = event.error;
      }

      recordResourceFailure(failure);
      return;
    }

    if (event instanceof ErrorEvent) {
      recordResourceFailure({
        kind: 'global',
        message: event.message,
        filename: event.filename || undefined,
        lineno: event.lineno || undefined,
        colno: event.colno || undefined,
        error: event.error,
      });
    }
  };

  const unhandledRejectionHandler = (event: PromiseRejectionEvent) => {
    unhandledRejections.push({ reason: event.reason });
  };

  window.addEventListener('error', resourceErrorHandler, true);
  window.addEventListener('unhandledrejection', unhandledRejectionHandler);

  QUnit.on('testEnd', ({ name, status }) => {
    void originalFetch(`http://localhost:4201/fake/${name}`, {
      method: 'GET',
    }).catch(() => {});

    if (
      status === 'failed' &&
      (seen.length || resourceFailures.length || unhandledRejections.length)
    ) {
      flushDiagnostics(`during "${name}"`);
    }
    clearDiagnostics();
  });

  QUnit.on('runEnd', () => {
    if (seen.length || resourceFailures.length || unhandledRejections.length) {
      flushDiagnostics('before test run completed');
    }
    clearDiagnostics();
  });

  teardown = () => {
    window.fetch = originalFetch;
    window.removeEventListener('error', resourceErrorHandler, true);
    window.removeEventListener('unhandledrejection', unhandledRejectionHandler);
    teardown = undefined;
  };
}
