import { type CreditStrategy } from './credit-strategies';
import { CreditStrategyFactory } from './credit-strategies';

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

  private constructor(configJson: string) {
    this.initializeFromJson(configJson);
  }

  private initializeFromJson(configJson: string) {
    const configs: ProxyDestinationInput[] = JSON.parse(configJson);

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

  getDestinationConfig(url: string): AllowedProxyDestination | undefined {
    return Object.entries(this.destinations).find(([destinationUrl]) =>
      url.includes(destinationUrl),
    )?.[1];
  }

  isDestinationAllowed(url: string): boolean {
    return this.getDestinationConfig(url) !== undefined;
  }

  supportsStreaming(url: string): boolean {
    const config = this.getDestinationConfig(url);
    return config?.supportsStreaming ?? false;
  }

  static getInstance(configJson: string) {
    if (!AllowedProxyDestinations.instance) {
      AllowedProxyDestinations.instance = new AllowedProxyDestinations(
        configJson,
      );
    }

    return AllowedProxyDestinations.instance;
  }

  static reset(): void {
    AllowedProxyDestinations.instance = null;
  }
}
