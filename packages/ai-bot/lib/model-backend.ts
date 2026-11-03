import OpenAI from 'openai';

export interface ModelBackend {
  readonly provider: 'openrouter' | 'local' | 'boxel';
  readonly billing: 'credits' | 'unmetered' | 'hosted-credits';
  readonly titleModel: string;
  // Null means the hosted catalog owns model selection. Local backends
  // validate against the explicit/discovered list rather than falling back.
  readonly modelIds: readonly string[] | null;
  readonly client: OpenAI;
}

// Called once at the ai-bot startup boundary. There is no inference from the
// machine's platform, no hosted fallback and no reuse of a hosted key locally.
export async function modelBackendFromEnv(
  env: NodeJS.ProcessEnv,
): Promise<ModelBackend> {
  const provider = env.AI_MODEL_PROVIDER ?? 'openrouter';
  if (provider === 'openrouter') {
    if (!env.OPENROUTER_API_KEY)
      throw new Error('OPENROUTER_API_KEY is required');
    if (
      env.AI_MODEL_BASE_URL !== undefined ||
      env.AI_MODEL_API_KEY !== undefined ||
      env.AI_MODEL_IDS !== undefined
    ) {
      throw new Error(
        'AI_MODEL_BASE_URL, AI_MODEL_API_KEY and AI_MODEL_IDS require AI_MODEL_PROVIDER=local',
      );
    }
    return {
      provider,
      billing: 'credits',
      titleModel: env.AI_TITLE_MODEL ?? 'gpt-4o',
      modelIds: null,
      client: new OpenAI({
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey: env.OPENROUTER_API_KEY,
      }),
    };
  }
  if (provider === 'boxel') {
    if (
      !env.AI_MODEL_BASE_URL ||
      !env.AI_MODEL_API_KEY ||
      env.AI_MODEL_IDS !== undefined
    )
      throw new Error(
        'Boxel hosted models require a native gateway and no local model catalog',
      );
    const endpoint = new URL(env.AI_MODEL_BASE_URL);
    if (
      endpoint.protocol !== 'http:' ||
      endpoint.hostname !== '127.0.0.1' ||
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash
    )
      throw new Error('Boxel hosted model gateway must be on loopback');
    return {
      provider,
      billing: 'hosted-credits',
      modelIds: null,
      titleModel: env.AI_TITLE_MODEL ?? 'gpt-4o',
      client: new OpenAI({
        baseURL: endpoint.href,
        apiKey: env.AI_MODEL_API_KEY,
        fetch: (input, init) => fetch(input, { ...init, redirect: 'error' }),
      }),
    };
  }
  if (provider !== 'local')
    throw new Error('AI_MODEL_PROVIDER must be openrouter, boxel or local');
  if (!env.AI_MODEL_BASE_URL)
    throw new Error('AI_MODEL_BASE_URL is required for a local model');
  let base: URL;
  try {
    base = new URL(env.AI_MODEL_BASE_URL);
  } catch {
    throw new Error('AI_MODEL_BASE_URL must be an HTTP(S) URL');
  }
  if (
    !['http:', 'https:'].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  ) {
    throw new Error(
      'AI_MODEL_BASE_URL must be an HTTP(S) URL without credentials, a query or a fragment',
    );
  }
  if (!base.pathname.endsWith('/')) base.pathname += '/';
  const apiKey = env.AI_MODEL_API_KEY ?? null;
  if (apiKey !== null && !apiKey.trim())
    throw new Error('AI_MODEL_API_KEY must be nonempty when configured');
  const modelIds =
    env.AI_MODEL_IDS !== undefined
      ? configuredModelIds(env.AI_MODEL_IDS)
      : await discoverModelIds(base, apiKey);
  const titleModel = env.AI_TITLE_MODEL ?? modelIds[0];
  if (!modelIds.includes(titleModel))
    throw new Error(
      'AI_TITLE_MODEL is not available from the configured local model backend',
    );
  return {
    provider,
    billing: 'unmetered',
    titleModel,
    modelIds,
    client: new OpenAI({
      baseURL: base.href,
      // The SDK requires a value even for a local server with no auth. The
      // transport below removes Authorization entirely in that case.
      apiKey: apiKey ?? 'local-no-auth',
      fetch: async (input, init) => {
        const request = new Request(input, init);
        const signal = init?.signal ?? request.signal;
        const headers = new Headers(request.headers);
        if (apiKey === null) headers.delete('authorization');
        if (
          request.method !== 'POST' ||
          !new URL(request.url).pathname.endsWith('/chat/completions')
        ) {
          return fetch(request, { headers, signal, redirect: 'error' });
        }
        // This is the SDK/provider boundary. Keep arbitrary message contents
        // opaque; validate only the provider options this adapter translates.
        const body: unknown = await request.json();
        if (
          typeof body !== 'object' ||
          body === null ||
          Array.isArray(body) ||
          !('model' in body) ||
          typeof body.model !== 'string'
        ) {
          throw new Error('Invalid local chat-completion request');
        }
        if (!modelIds.includes(body.model))
          throw new Error(
            'The room selected a model unavailable from the configured local backend',
          );
        const translated = Object.fromEntries(Object.entries(body));
        // OpenRouter extensions and its attribution field are not OpenAI
        // inference options. Never let a local server silently interpret them.
        delete translated.usage;
        delete translated.provider;
        delete translated.user;
        // Boxel's explicit null means thinking is off; Ollama names that
        // choice "none" rather than treating null as the model default.
        if (translated.reasoning_effort === null)
          translated.reasoning_effort = 'none';
        if (translated.tool_choice === 'none') {
          delete translated.tools;
        } else if (
          translated.tool_choice !== undefined &&
          translated.tool_choice !== 'auto'
        ) {
          throw new Error(
            'This local backend supports automatic tool selection or no tools; forced tool selection is unsupported',
          );
        }
        delete translated.tool_choice;
        return fetch(request, {
          headers,
          signal,
          body: JSON.stringify(translated),
          redirect: 'error',
        });
      },
    }),
  };
}

function configuredModelIds(raw: string): string[] {
  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    throw new Error('AI_MODEL_IDS must be a nonempty JSON array of model IDs');
  }
  return parseModelIds(input);
}

function parseModelIds(input: unknown): string[] {
  if (
    !Array.isArray(input) ||
    input.length === 0 ||
    !input.every(
      (id): id is string => typeof id === 'string' && id.trim().length > 0,
    )
  ) {
    throw new Error('AI_MODEL_IDS must be a nonempty JSON array of model IDs');
  }
  return [...new Set(input)];
}

async function discoverModelIds(
  base: URL,
  apiKey: string | null,
): Promise<string[]> {
  let response: Response;
  try {
    response = await fetch(new URL('models', base), {
      headers: apiKey === null ? {} : { Authorization: `Bearer ${apiKey}` },
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new Error('Cannot reach the configured local model catalog');
  }
  if (!response.ok)
    throw new Error(`Local model catalog returned HTTP ${response.status}`);
  const input: unknown = await response.json();
  if (
    typeof input !== 'object' ||
    input === null ||
    !('data' in input) ||
    !Array.isArray(input.data)
  ) {
    throw new Error('Invalid local model catalog');
  }
  return parseModelIds(
    input.data.map((entry: unknown) => {
      if (typeof entry !== 'object' || entry === null || !('id' in entry))
        throw new Error('Invalid local model catalog entry');
      return entry.id;
    }),
  );
}
