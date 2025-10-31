import type { CreditStrategy } from './credit-strategies';
import { CreditStrategyFactory } from './credit-strategies';

export interface ExternalEndpointConfig {
  url: string;
  apiKey: string;
  creditStrategy: CreditStrategy;
  supportsStreaming: boolean;
}

interface EndpointConfigInput {
  url: string;
  apiKey: string;
  creditStrategy: 'openrouter' | 'no-credit';
  supportsStreaming: boolean;
}

export class allowedProxyDestinations {
  private endpoints: Record<string, ExternalEndpointConfig> = {};
  private static instance: allowedProxyDestinations | null = null;

  private constructor(configJson: string) {
    this.initializeFromJson(configJson);
  }

  private initializeFromJson(configJson: string) {
    const configs: EndpointConfigInput[] = JSON.parse(configJson);

    this.endpoints = {};
    for (const config of configs) {
      this.endpoints[config.url] = {
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

  getEndpointConfig(url: string): ExternalEndpointConfig | undefined {
    return Object.entries(this.endpoints).find(([endpointUrl]) =>
      url.includes(endpointUrl),
    )?.[1];
  }

  isEndpointWhitelisted(url: string): boolean {
    return this.getEndpointConfig(url) !== undefined;
  }

  supportsStreaming(url: string): boolean {
    const config = this.getEndpointConfig(url);
    return config?.supportsStreaming ?? false;
  }

  static getInstance(configJson: string) {
    if (!allowedProxyDestinations.instance) {
      allowedProxyDestinations.instance = new allowedProxyDestinations(
        configJson,
      );
    }

    return allowedProxyDestinations.instance;
  }

  static reset(): void {
    allowedProxyDestinations.instance = null;
  }
}
