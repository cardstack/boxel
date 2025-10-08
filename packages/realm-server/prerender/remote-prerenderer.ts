import {
  type Prerenderer,
  type RenderResponse,
  logger,
} from '@cardstack/runtime-common';

const log = logger('remote-prerenderer');

export function createRemotePrerenderer(
  prerenderServerURL: string,
): Prerenderer {
  let prerenderURL = new URL(prerenderServerURL);
  return async function prerender({
    realm,
    url,
    userId,
    permissions,
  }: Parameters<Prerenderer>[0]): Promise<RenderResponse> {
    let endpoint = new URL('prerender', prerenderURL);

    let body = {
      data: {
        type: 'prerender-request',
        attributes: {
          realm,
          url,
          userId,
          permissions,
        },
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

    let renderResponse: RenderResponse | undefined = json?.data?.attributes;
    if (!renderResponse) {
      throw new Error('Prerender response did not contain data.attributes');
    }

    console.log(
      `====> received prerender request for ${url}:\n${JSON.stringify(renderResponse.serialized, null, 2)}`,
    );

    return renderResponse;
  };
}
