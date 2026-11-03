const SERVICE_STATES = [
  'stopped',
  'starting',
  'ready',
  'stopping',
  'failed',
] as const;
const STACK_STATES = [
  'stopped',
  'starting',
  'ready',
  'stopping',
  'degraded',
  'failed',
] as const;
type ServiceState = (typeof SERVICE_STATES)[number];
type StackState = (typeof STACK_STATES)[number];

export interface LocalStackStatus {
  protocolVersion: 1;
  stack: string;
  mode: 'remote' | 'local' | 'source';
  state: StackState;
  url: string | null;
  services: Record<
    string,
    {
      name: string;
      state: ServiceState;
      managed: boolean;
      pid: number | null;
      lastError: string | null;
    }
  >;
}
export interface LocalStackDoctor {
  ok: boolean;
  stack: string;
  checks: { name: string; ok: boolean; detail: string }[];
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function member<T extends string>(
  value: unknown,
  choices: readonly T[],
): value is T {
  return (
    typeof value === 'string' && choices.some((choice) => choice === value)
  );
}
function stackName(stack: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(stack))
    throw new Error('Invalid local stack name');
}
function parseStatus(value: unknown, stack: string): LocalStackStatus {
  if (
    !record(value) ||
    value.protocolVersion !== 1 ||
    value.stack !== stack ||
    !member(value.mode, ['remote', 'local', 'source']) ||
    !member(value.state, STACK_STATES) ||
    !(value.url === null || typeof value.url === 'string') ||
    !record(value.services)
  )
    throw new Error('Invalid or incompatible Boxel runtime status');
  let services: LocalStackStatus['services'] = {};
  for (let [name, service] of Object.entries(value.services)) {
    if (
      !record(service) ||
      service.name !== name ||
      !member(service.state, SERVICE_STATES) ||
      typeof service.managed !== 'boolean' ||
      !(
        service.pid === null ||
        (typeof service.pid === 'number' &&
          Number.isSafeInteger(service.pid) &&
          service.pid > 0)
      ) ||
      !(service.lastError === null || typeof service.lastError === 'string')
    )
      throw new Error('Invalid Boxel runtime service status');
    services[name] = {
      name,
      state: service.state,
      managed: service.managed,
      pid: service.pid,
      lastError: service.lastError,
    };
  }
  return {
    protocolVersion: 1,
    stack,
    mode: value.mode,
    state: value.state,
    url: value.url,
    services,
  };
}

/** Native runtime controls; this client is never exposed to a Boxel page. */
export class BoxelRuntimeClient {
  readonly #endpoint: string;
  constructor(
    endpoint = process.env.BOXEL_RUNTIME_URL ?? 'http://127.0.0.1:4243',
  ) {
    let url: URL;
    try {
      url = new URL(endpoint);
    } catch {
      throw new Error('Invalid Boxel runtime endpoint');
    }
    if (
      url.protocol !== 'http:' ||
      !['127.0.0.1', '[::1]'].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/'
    )
      throw new Error(
        'Boxel runtime endpoint must be an HTTP loopback origin without credentials',
      );
    this.#endpoint = url.origin;
  }
  async #request(
    operation: 'up' | 'down' | 'status' | 'doctor',
    stack: string,
  ): Promise<Record<string, unknown>> {
    stackName(stack);
    let response: Response;
    try {
      response = await fetch(
        `${this.#endpoint}/v1/stacks/${encodeURIComponent(stack)}/${operation}`,
        {
          method: operation === 'up' || operation === 'down' ? 'POST' : 'GET',
          redirect: 'error',
          signal: AbortSignal.timeout(600_000),
        },
      );
    } catch {
      throw new Error(
        'Cannot reach the local Boxel runtime. Start Boxel Desktop or boxel-local serve.',
      );
    }
    if (!response.ok)
      throw new Error(
        `Boxel runtime ${operation} failed (HTTP ${response.status})`,
      );
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new Error('Invalid Boxel runtime response');
    }
    if (!record(payload) || payload.ok !== true)
      throw new Error('Boxel runtime operation failed');
    return payload;
  }
  async up(stack = 'default'): Promise<LocalStackStatus> {
    return parseStatus((await this.#request('up', stack)).status, stack);
  }
  async down(stack = 'default'): Promise<LocalStackStatus> {
    return parseStatus((await this.#request('down', stack)).status, stack);
  }
  async status(stack = 'default'): Promise<LocalStackStatus> {
    return parseStatus((await this.#request('status', stack)).status, stack);
  }
  async doctor(stack = 'default'): Promise<LocalStackDoctor> {
    let value = (await this.#request('doctor', stack)).result;
    if (
      !record(value) ||
      value.stack !== stack ||
      typeof value.ok !== 'boolean' ||
      !Array.isArray(value.checks)
    )
      throw new Error('Invalid Boxel runtime doctor result');
    let checks: LocalStackDoctor['checks'] = [];
    for (let check of value.checks) {
      if (
        !record(check) ||
        typeof check.name !== 'string' ||
        typeof check.ok !== 'boolean' ||
        typeof check.detail !== 'string'
      )
        throw new Error('Invalid Boxel runtime doctor check');
      checks.push({ name: check.name, ok: check.ok, detail: check.detail });
    }
    return { stack, ok: value.ok, checks };
  }
}
