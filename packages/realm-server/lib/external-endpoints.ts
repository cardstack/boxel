import { type CreditStrategy, AICreditStrategy } from './credit-strategies';

export interface ExternalEndpointConfig {
  url: string;
  apiKey: string;
  creditStrategy: CreditStrategy;
  whitelisted: boolean;
}

export const EXTERNAL_ENDPOINTS: Record<string, ExternalEndpointConfig> = {
  'https://openrouter.ai/api/v1': {
    url: 'https://openrouter.ai/api/v1',
    apiKey: process.env.OPENROUTER_API_KEY!,
    creditStrategy: new AICreditStrategy(),
    whitelisted: true,
  },
};

export function isEndpointWhitelisted(url: string): boolean {
  return EXTERNAL_ENDPOINTS[url]?.whitelisted ?? false;
}

export function getEndpointConfig(url: string): ExternalEndpointConfig | null {
  return EXTERNAL_ENDPOINTS[url] ?? null;
}

export function getAllowedEndpoints(): string[] {
  return Object.keys(EXTERNAL_ENDPOINTS).filter(
    (url) => EXTERNAL_ENDPOINTS[url].whitelisted,
  );
}
