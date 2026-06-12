import type { CreditStrategy } from './credit-strategies.ts';
import { CreditStrategyFactory } from './credit-strategies.ts';
import { type DBAdapter, logger } from '@cardstack/runtime-common';

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

// Matches IPv4/IPv6 literals (and `localhost`) that resolve to loopback,
// link-local, or RFC 1918 private ranges. Hostnames that aren't IP literals
// are treated as public; the origin allowlist is the primary control.
function isNonPublicHost(hostname: string): boolean {
  let host = hostname.toLowerCase();
  // IPv6 addresses arrive wrapped in brackets from URL.hostname.
  host = host.replace(/^\[/, '').replace(/\]$/, '');

  if (host === 'localhost' || host.endsWith('.localhost')) {
    return true;
  }

  // IPv6 loopback / link-local / unique-local.
  if (host === '::1' || host === '::') {
    return true;
  }
  if (
    host.startsWith('fe80:') || // link-local
    host.startsWith('fc') || // unique-local fc00::/7
    host.startsWith('fd')
  ) {
    return true;
  }
  // IPv4-mapped IPv6, e.g. ::ffff:169.254.169.254
  let mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(host);
  if (mapped) {
    host = mapped[1];
  }

  let ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!ipv4) {
    return false;
  }
  let [a, b] = ipv4.slice(1).map(Number);
  if (a === 127) return true; // loopback 127.0.0.0/8
  if (a === 10) return true; // private 10.0.0.0/8
  if (a === 169 && b === 254) return true; // link-local 169.254.0.0/16
  if (a === 172 && b >= 16 && b <= 31) return true; // private 172.16.0.0/12
  if (a === 192 && b === 168) return true; // private 192.168.0.0/16
  if (a === 0) return true; // 0.0.0.0/8
  return false;
}

export interface AllowedProxyDestination {
  url: string;
  apiKey: string;
  creditStrategy: CreditStrategy;
  supportsStreaming: boolean;
  authMethod: AuthMethod;
  authParameterName?: string; // For URL parameter auth, e.g., 'key' for Google, 'api_key' for others
}

interface ProxyEndpointRow {
  id: string;
  url: string;
  api_key: string;
  credit_strategy: string;
  supports_streaming: boolean;
  auth_method?: string;
  auth_parameter_name?: string;
  created_at: string;
  updated_at: string;
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

  private async loadFromDatabase() {
    try {
      const result = await this.dbAdapter.execute(
        'SELECT * FROM proxy_endpoints',
      );

      if (result.length === 0) {
        this.destinations = {};
        return;
      }

      const endpoints = result as unknown as ProxyEndpointRow[];
      this.initializeFromEndpoints(endpoints);
    } catch (error) {
      log.error(
        'Failed to load allowed proxy destinations from database:',
        error,
      );
      this.destinations = {};
    }
  }

  private initializeFromEndpoints(endpoints: ProxyEndpointRow[]) {
    this.destinations = {};
    for (const endpoint of endpoints) {
      this.destinations[endpoint.url] = {
        url: endpoint.url,
        apiKey: endpoint.api_key,
        creditStrategy: CreditStrategyFactory.create(
          endpoint.credit_strategy as 'openrouter' | 'no-credit',
          endpoint.api_key,
        ),
        supportsStreaming: endpoint.supports_streaming,
        authMethod: (endpoint.auth_method || 'header') as AuthMethod, // Default to header for backward compatibility
        authParameterName: endpoint.auth_parameter_name,
      };
    }
  }

  private async ensureCacheValid() {
    const now = Date.now();
    if (now > this.cacheExpiry) {
      await this.loadFromDatabase();
      this.cacheExpiry = now + this.CACHE_DURATION;
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

    // Never forward to a non-public host, even if a destination is somehow
    // configured to one. This is defense-in-depth against SSRF: the
    // origin match below already pins the request to a configured
    // destination origin.
    if (isNonPublicHost(requestUrl.hostname)) {
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
}
