const requestKind = 'boxel-sandbox-fetch-request' as const;
const responseKind = 'boxel-sandbox-fetch-response' as const;
const maxModuleBytes = 8 * 1024 * 1024;
const forwardedRequestHeaders = new Set([
  'accept',
  'if-modified-since',
  'if-none-match',
]);
const forwardedResponseHeaders = new Set([
  'cache-control',
  'content-type',
  'etag',
  'last-modified',
]);

interface SandboxFetchRequest {
  kind: typeof requestKind;
  requestId: string;
  url: string;
  headers: [string, string][];
  /**
   * 'module' (default): an executable read, checked against the classified
   * module graph. 'media': a declarative-asset read (an authored `<img>`)
   * — never executable, never admitted to the module graph, validated as
   * image content instead. The two purposes exist because a credentialless
   * iframe strips the browser session that lets main render private-realm
   * images in-document; the Host re-brokers exactly that ability, bounded
   * to GET + image/* + a size cap (see SandboxMediaBridge).
   */
  purpose?: 'module' | 'media';
}

interface SandboxFetchResponse {
  kind: typeof responseKind;
  requestId: string;
  ok: boolean;
  response?: {
    status: number;
    statusText: string;
    url: string;
    headers: [string, string][];
    body: ArrayBuffer;
  };
  error?: string;
}

interface PendingFetch {
  resolve(response: Response): void;
  reject(error: Error): void;
}

/** Child-side fetch function backed only by the private Sandbox port. */
export class SandboxFetchClient {
  private nextRequest = 0;
  private pending = new Map<string, PendingFetch>();

  constructor(private readonly port: MessagePort) {
    port.addEventListener('message', this.receive);
  }

  fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    let request = input instanceof Request ? input : new Request(input, init);
    if (request.method !== 'GET') {
      throw new Error('The Sandbox module loader only supports GET');
    }
    return this.post({
      kind: requestKind,
      requestId: `module:${++this.nextRequest}`,
      url: request.url,
      headers: [...request.headers.entries()],
    });
  };

  /** Declarative-asset read; see SandboxFetchRequest['purpose']. */
  fetchMedia = async (url: string): Promise<Response> => {
    return this.post({
      kind: requestKind,
      requestId: `media:${++this.nextRequest}`,
      url,
      headers: [['accept', 'image/*']],
      purpose: 'media',
    });
  };

  private post(message: SandboxFetchRequest): Promise<Response> {
    return new Promise<Response>((resolve, reject) => {
      this.pending.set(message.requestId, { resolve, reject });
      try {
        this.port.postMessage(message);
      } catch (error) {
        this.pending.delete(message.requestId);
        reject(asError(error));
      }
    });
  }

  destroy(): void {
    this.port.removeEventListener('message', this.receive);
    for (let pending of this.pending.values()) {
      pending.reject(new Error('Sandbox module fetch was destroyed'));
    }
    this.pending.clear();
  }

  private receive = (event: MessageEvent<unknown>) => {
    let message = event.data;
    if (!isFetchResponse(message)) {
      return;
    }
    let pending = this.pending.get(message.requestId);
    if (!pending) {
      return;
    }
    this.pending.delete(message.requestId);
    if (!message.ok || !message.response) {
      pending.reject(new Error(message.error ?? 'Sandbox module fetch failed'));
      return;
    }
    // Response() throws for a body paired with a null-body status.
    let nullBodyStatus = [101, 204, 205, 304].includes(message.response.status);
    let response = new Response(nullBodyStatus ? null : message.response.body, {
      status: message.response.status,
      statusText: message.response.statusText,
      headers: message.response.headers,
    });
    Object.defineProperty(response, 'url', {
      configurable: true,
      value: message.response.url,
    });
    pending.resolve(response);
  };
}

/**
 * Parent-side module read capability.
 *
 * The Sandbox receives no ambient credentials. Every read is checked against
 * the statically classified module graph before the Host performs an
 * authenticated fetch. This is an execution-internal capability, not a
 * general authored-card network API.
 */
export class SandboxFetchServer {
  constructor(
    private readonly port: MessagePort,
    private readonly fetch: typeof globalThis.fetch,
    private readonly isAllowed: (url: string) => boolean,
    private readonly observeModule?: (
      url: string,
      contentType: string | null,
      body: ArrayBuffer,
    ) => Promise<void>,
    /**
     * Sandbox HMR (RP-17.1 un-deferral): an unsaved draft, keyed by its
     * exact fetch URL — never pattern-matched, mirroring the frozen
     * branch's private Monaco-buffer rule. Consulted before the network on
     * every read; a hit serves the draft's source text as a synthesized
     * response instead of the realm's persisted (saved) source, without
     * this server having to know anything about draft lifecycle beyond
     * "does one exist for this exact URL right now."
     */
    private readonly getDraftOverride?: (url: string) => string | undefined,
    /**
     * Resolves an admitted module spelling to the URL the Host should read.
     * The child can legitimately hold a persisted Base alias from another
     * deployment (for example localhost:4201); authorization checks both
     * spellings, while the parent fetch always uses the current deployment's
     * configured URL.
     */
    private readonly resolveModuleURL: (url: string) => string = (url) => url,
  ) {
    port.addEventListener('message', this.receive);
  }

  destroy(): void {
    this.port.removeEventListener('message', this.receive);
  }

  private receive = (event: MessageEvent<unknown>) => {
    let request = event.data;
    if (!isFetchRequest(request)) {
      return;
    }
    void this.respond(request);
  };

  private async respond(request: SandboxFetchRequest): Promise<void> {
    if ((request.purpose ?? 'module') === 'media') {
      return this.respondMedia(request);
    }
    let message: SandboxFetchResponse;
    try {
      let resolvedURL = this.resolveModuleURL(request.url);
      if (!this.isAllowed(request.url)) {
        throw new Error(
          `Sandbox module read is outside its classified graph: ${request.url}`,
        );
      }
      let draftSource =
        this.getDraftOverride?.(request.url) ??
        this.getDraftOverride?.(resolvedURL);
      if (draftSource !== undefined) {
        let body = new TextEncoder().encode(draftSource).buffer;
        // The draft's own newly-introduced imports (edge case 8/§3) are
        // admitted the same way any other observed response's imports are
        // — the Host also independently re-allows the draft's classified
        // module graph before ever setting this override (see
        // BoxelExecutionSession.pushDraft), so this call is defense in
        // depth, not the sole admission path.
        await this.observeModule?.(resolvedURL, 'text/javascript', body);
        message = {
          kind: responseKind,
          requestId: request.requestId,
          ok: true,
          response: {
            status: 200,
            statusText: 'OK',
            url: resolvedURL,
            headers: [['content-type', 'text/javascript']],
            body,
          },
        };
        this.port.postMessage(message, [body]);
        return;
      }
      let headers = new Headers();
      for (let [name, value] of request.headers) {
        if (forwardedRequestHeaders.has(name.toLowerCase())) {
          headers.set(name, value);
        }
      }
      let response = await this.fetch(resolvedURL, {
        method: 'GET',
        headers,
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        redirect: 'error',
      });
      if (!this.isAllowed(response.url || request.url)) {
        throw new Error(
          `Sandbox module response escaped its classified graph: ${
            response.url || request.url
          }`,
        );
      }
      let body = await response.arrayBuffer();
      if (body.byteLength > maxModuleBytes) {
        throw new Error('Sandbox module response exceeds the size limit');
      }
      await this.observeModule?.(
        response.url || request.url,
        response.headers.get('content-type'),
        body,
      );
      message = {
        kind: responseKind,
        requestId: request.requestId,
        ok: true,
        response: {
          status: response.status,
          statusText: response.statusText,
          url: response.url,
          headers: [...response.headers.entries()].filter(([name]) =>
            forwardedResponseHeaders.has(name.toLowerCase()),
          ),
          body,
        },
      };
    } catch (error) {
      message = {
        kind: responseKind,
        requestId: request.requestId,
        ok: false,
        error: asError(error).message,
      };
    }
    this.port.postMessage(
      message,
      message.response ? [message.response.body] : [],
    );
  }

  /**
   * Declarative-media read (`purpose: 'media'`): never consults the
   * classified module graph, the draft overrides, or observeModule — an
   * image is not executable and must never become admitted module state.
   * The Host fetch carries the user's realm authorization, which is the
   * SAME authority main grants every in-document `<img>` via the browser
   * session; the credentialless iframe merely lost it. Bounded to GET,
   * image/* responses, and the shared size cap. Non-image or oversized
   * responses fail the request; the child-side bridge then restores the
   * authored URL so public assets still render credentiallessly.
   */
  private async respondMedia(request: SandboxFetchRequest): Promise<void> {
    let message: SandboxFetchResponse;
    try {
      let url = new URL(request.url);
      if (!['http:', 'https:'].includes(url.protocol)) {
        throw new Error('Sandbox media reads support only HTTP(S)');
      }
      let headers = new Headers();
      for (let [name, value] of request.headers) {
        if (forwardedRequestHeaders.has(name.toLowerCase())) {
          headers.set(name, value);
        }
      }
      let response = await this.fetch(url.href, {
        method: 'GET',
        headers,
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        redirect: 'error',
      });
      let contentType = response.headers.get('content-type')?.toLowerCase();
      if (response.ok && !contentType?.startsWith('image/')) {
        throw new Error('Sandbox media response was not an image');
      }
      let body = await response.arrayBuffer();
      if (body.byteLength > maxModuleBytes) {
        throw new Error('Sandbox media response exceeds the size limit');
      }
      message = {
        kind: responseKind,
        requestId: request.requestId,
        ok: true,
        response: {
          status: response.status,
          statusText: response.statusText,
          url: response.url || request.url,
          headers: [...response.headers.entries()].filter(([name]) =>
            forwardedResponseHeaders.has(name.toLowerCase()),
          ),
          body,
        },
      };
    } catch (error) {
      message = {
        kind: responseKind,
        requestId: request.requestId,
        ok: false,
        error: asError(error).message,
      };
    }
    this.port.postMessage(
      message,
      message.response ? [message.response.body] : [],
    );
  }
}

function isFetchRequest(value: unknown): value is SandboxFetchRequest {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    value.kind === requestKind &&
    'requestId' in value &&
    typeof value.requestId === 'string' &&
    value.requestId.length > 0 &&
    value.requestId.length <= 256 &&
    'url' in value &&
    typeof value.url === 'string' &&
    'headers' in value &&
    Array.isArray(value.headers) &&
    value.headers.length <= 32 &&
    value.headers.every(
      (header) =>
        Array.isArray(header) &&
        header.length === 2 &&
        header.every((part) => typeof part === 'string' && part.length <= 8192),
    ) &&
    (!('purpose' in value) ||
      value.purpose === undefined ||
      value.purpose === 'module' ||
      value.purpose === 'media')
  );
}

function isFetchResponse(value: unknown): value is SandboxFetchResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    value.kind === responseKind &&
    'requestId' in value &&
    typeof value.requestId === 'string' &&
    'ok' in value &&
    typeof value.ok === 'boolean'
  );
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
