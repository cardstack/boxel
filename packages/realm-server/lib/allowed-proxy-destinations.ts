import type { CreditStrategy } from './credit-strategies.ts';
import { CreditStrategyFactory } from './credit-strategies.ts';
import { type DBAdapter, logger } from '@cardstack/runtime-common';
import {
  PROXY_ENDPOINT_KEY_COLUMNS,
  readProxyEndpointKey,
  type ProxyEndpointKeyRow,
} from './proxy-endpoint-keys.ts';

const log = logger('allowed-proxy-destinations');

export type AuthMethod = 'header' | 'url-parameter';

// A request URL is allowed only when it targets the exact same origin as a
// configured destination AND its path falls under the destination's path. A
// substring/`includes` check is unsafe: an attacker can embed an allowlisted
// string anywhere in an otherwise hostile URL (e.g.
// `https://attacker.example/x?=https://openrouter.ai/...`) to pass the check
// and have the server attach the real upstream API key while fetching the
// attacker's host.
function matchesDestination(requestUrl: URL, destinationUrl: string): boolean {
  let destination: URL;
  try {
    destination = new URL(destinationUrl);
  } catch {
    return false;
  }

  if (requestUrl.origin !== destination.origin) {
    return false;
  }

  let requestPath = requestUrl.pathname;
  let destinationPath = destination.pathname;

  // Exact path, or the request path is nested under the destination path at a
  // segment boundary (so `/v1` does not match `/v1-evil`).
  if (requestPath === destinationPath) {
    return true;
  }
  if (destinationPath.endsWith('/')) {
    return requestPath.startsWith(destinationPath);
  }
  return requestPath.startsWith(`${destinationPath}/`);
}

// A system key is named by its endpoint's configured URL, which is what logs
// and errors record in place of the value.
// Whether two destinations can match the same request URL: one's path lies
// under the other's on the same origin.
export function destinationsOverlap(a: string, b: string): boolean {
  let parse = (url: string) => {
    try {
      return new URL(url);
    } catch {
      return undefined;
    }
  };
  let urlA = parse(a);
  let urlB = parse(b);
  if (!urlA || !urlB) {
    return false;
  }
  return matchesDestination(urlA, b) || matchesDestination(urlB, a);
}

export function systemKeyName(endpointUrl: string): string {
  return `system:${endpointUrl}`;
}

export interface AllowedProxyDestination {
  url: string;
  apiKey: string;
  creditStrategy: CreditStrategy;
  supportsStreaming: boolean;
  authMethod: AuthMethod;
  authParameterName?: string; // For URL parameter auth, e.g., 'key' for Google, 'api_key' for others
}

interface ProxyEndpointRow extends ProxyEndpointKeyRow {
  credit_strategy: string;
  supports_streaming: boolean;
  auth_method?: string;
  auth_parameter_name?: string;
}

export class AllowedProxyDestinations {
  private destinations: Record<string, AllowedProxyDestination> = {};
  private static instance: AllowedProxyDestinations | null = null;
  private dbAdapter: DBAdapter;
  private cacheExpiry: number = 0;
  private readonly CACHE_DURATION = 5000; // 5 seconds

  private constructor(dbAdapter: DBAdapter) {
    this.dbAdapter = dbAdapter;
  }

  // Bumped by every `invalidate()`. A reload applies its rows, and extends the
  // cache, only if no invalidation happened while it ran, so a reload that
  // read the table before a change can't put the old rows back.
  private generation = 0;

  private async loadFromDatabase(): Promise<
    Record<string, AllowedProxyDestination>
  > {
    try {
      const result = await this.dbAdapter.execute(
        `SELECT id, url, credit_strategy, supports_streaming, auth_method,
           auth_parameter_name, ${PROXY_ENDPOINT_KEY_COLUMNS}
         FROM proxy_endpoints`,
      );
      return this.destinationsFromEndpoints(
        result as unknown as ProxyEndpointRow[],
      );
    } catch (error) {
      log.error(
        'Failed to load allowed proxy destinations from database:',
        error,
      );
      return {};
    }
  }

  private destinationsFromEndpoints(
    endpoints: ProxyEndpointRow[],
  ): Record<string, AllowedProxyDestination> {
    const destinations: Record<string, AllowedProxyDestination> = {};
    for (const endpoint of endpoints) {
      // A row with no key passes its null through, as the column allows.
      const apiKey = readProxyEndpointKey(endpoint) as string;
      destinations[endpoint.url] = {
        url: endpoint.url,
        apiKey,
        creditStrategy: CreditStrategyFactory.create(
          endpoint.credit_strategy as 'openrouter' | 'no-credit',
          apiKey,
          systemKeyName(endpoint.url),
        ),
        supportsStreaming: endpoint.supports_streaming,
        authMethod: (endpoint.auth_method || 'header') as AuthMethod, // Default to header for backward compatibility
        authParameterName: endpoint.auth_parameter_name,
      };
    }
    return destinations;
  }

  private async ensureCacheValid() {
    const now = Date.now();
    if (now > this.cacheExpiry) {
      const generation = this.generation;
      const destinations = await this.loadFromDatabase();
      if (generation === this.generation) {
        this.destinations = destinations;
        this.cacheExpiry = now + this.CACHE_DURATION;
      } else {
        // The table changed while this reload ran; read it again.
        await this.ensureCacheValid();
      }
    }
  }

  async getDestinationConfig(
    url: string,
  ): Promise<AllowedProxyDestination | undefined> {
    await this.ensureCacheValid();

    let requestUrl: URL;
    try {
      requestUrl = new URL(url);
    } catch {
      // Unparseable URL can never match an allowlisted destination.
      return undefined;
    }

    return Object.entries(this.destinations).find(([destinationUrl]) =>
      matchesDestination(requestUrl, destinationUrl),
    )?.[1];
  }

  async isDestinationAllowed(url: string): Promise<boolean> {
    return (await this.getDestinationConfig(url)) !== undefined;
  }

  async supportsStreaming(url: string): Promise<boolean> {
    const config = await this.getDestinationConfig(url);
    return config?.supportsStreaming ?? false;
  }

  static getInstance(dbAdapter: DBAdapter) {
    if (!AllowedProxyDestinations.instance) {
      AllowedProxyDestinations.instance = new AllowedProxyDestinations(
        dbAdapter,
      );
    }

    return AllowedProxyDestinations.instance;
  }

  static reset(): void {
    AllowedProxyDestinations.instance = null;
  }

  // The next lookup reloads the endpoints, so a change written by this
  // process applies to its next request.
  static invalidate(): void {
    let instance = AllowedProxyDestinations.instance;
    if (instance) {
      instance.generation++;
      instance.cacheExpiry = 0;
    }
  }
}
