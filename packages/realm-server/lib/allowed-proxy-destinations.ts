import { type CreditStrategy } from './credit-strategies';
import { CreditStrategyFactory } from './credit-strategies';
import { type DBAdapter, logger } from '@cardstack/runtime-common';

const log = logger('allowed-proxy-destinations');

export interface AllowedProxyDestination {
  url: string;
  apiKey: string;
  creditStrategy: CreditStrategy;
  supportsStreaming: boolean;
}

interface ProxyDestinationInput {
  url: string;
  apiKey: string;
  creditStrategy: 'openrouter' | 'no-credit';
  supportsStreaming: boolean;
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
        'SELECT value FROM server_config WHERE key = $1',
        { bind: ['allowed_proxy_destinations'] },
      );

      if (result.length === 0) {
        this.destinations = {};
        return;
      }

      const configs = result[0].value as unknown as ProxyDestinationInput[];
      this.initializeFromConfigs(configs);
    } catch (error) {
      log.error(
        'Failed to load allowed proxy destinations from database:',
        error,
      );
      this.destinations = {};
    }
  }

  private initializeFromConfigs(configs: ProxyDestinationInput[]) {
    this.destinations = {};
    for (const config of configs) {
      this.destinations[config.url] = {
        url: config.url,
        apiKey: config.apiKey,
        creditStrategy: CreditStrategyFactory.create(
          config.creditStrategy,
          config.apiKey,
        ),
        supportsStreaming: config.supportsStreaming,
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
