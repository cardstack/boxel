import type { CreditStrategy } from './credit-strategies';
import { CreditStrategyFactory } from './credit-strategies';
import { type DBAdapter, logger } from '@cardstack/runtime-common';

const log = logger('allowed-proxy-destinations');

export type AuthMethod = 'header' | 'url-parameter';

export interface AllowedProxyDestination {
  url: string;
  apiKey: string;
  credentials?: Record<string, unknown> | null;
  creditStrategy: CreditStrategy;
  supportsStreaming: boolean;
  authMethod: AuthMethod;
  authParameterName?: string; // For URL parameter auth, e.g., 'key' for Google, 'api_key' for others
}

interface ProxyEndpointRow {
  id: string;
  url: string;
  api_key: string;
  credentials?: any;
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
        credentials: endpoint.credentials ?? null,
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
    return Object.entries(this.destinations).find(([destinationUrl]) =>
      url.includes(destinationUrl),
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
