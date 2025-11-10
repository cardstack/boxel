import {
  type Prerenderer,
  type RenderResponse,
  type ModulePrerenderResponse,
  logger,
} from '@cardstack/runtime-common';

const log = logger('remote-prerenderer');

export function createRemotePrerenderer(
  prerenderServerURL: string,
): Prerenderer {
  let prerenderURL = new URL(prerenderServerURL);

  async function request<T>(
    path: string,
    type: string,
    attributes: Record<string, unknown>,
  ): Promise<T> {
    let endpoint = new URL(path, prerenderURL);
    let body = {
      data: {
        type,
        attributes,
      },
    };

    let response = await fetch(endpoint, {
      method: 'POST',
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      let message = `Prerender request to ${endpoint.href} failed with status ${response.status}`;
      let text: string | undefined;
      try {
        text = await response.text();
      } catch (err) {
        log.error('Error reading prerender response body:', err);
      }
      if (text) {
        message += `: ${text}`;
      }
      throw new Error(message);
    }

    let json: any;
    try {
      json = await response.json();
    } catch (e) {
      throw new Error('Failed to parse prerender response as JSON');
    }

    let attributesPayload: T | undefined = json?.data?.attributes;
    if (!attributesPayload) {
      throw new Error('Prerender response did not contain data.attributes');
    }

    return attributesPayload;
  }

  return {
    async prerenderCard({ realm, url, userId, permissions, renderOptions }) {
      return await request<RenderResponse>(
        'prerender-card',
        'prerender-request',
        {
          realm,
          url,
          userId,
          permissions,
          renderOptions: renderOptions ?? {},
        },
      );
    },
    async prerenderModule({ realm, url, userId, permissions, renderOptions }) {
      return await request<ModulePrerenderResponse>(
        'prerender-module',
        'prerender-module-request',
        {
          realm,
          url,
          userId,
          permissions,
          renderOptions: renderOptions ?? {},
        },
      );
    },
  };
}
