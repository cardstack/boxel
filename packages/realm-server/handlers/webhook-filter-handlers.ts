import type Koa from 'koa';

export interface WebhookFilterHandler {
  /** Return true if this payload matches the filter configuration. */
  matches(
    payload: Record<string, any>,
    headers: Koa.Context['req']['headers'],
    filter: Record<string, any>,
  ): boolean;

  /** Assemble the command input from the webhook payload and filter config. */
  buildCommandInput(
    payload: Record<string, any>,
    headers: Koa.Context['req']['headers'],
    filter: Record<string, any>,
  ): Record<string, any>;

  /** Determine the realm URL where the command should run. */
  getRealmURL(filter: Record<string, any>, commandURL: string): string;
}

/**
 * Handler for GitHub webhook events. Supports filtering by event type
 * (from X-GitHub-Event header).
 */
class GithubEventFilterHandler implements WebhookFilterHandler {
  matches(
    _payload: Record<string, any>,
    headers: Koa.Context['req']['headers'],
    filter: Record<string, any>,
  ): boolean {
    let eventType = headers['x-github-event'] as string | undefined;

    if (filter.eventType && filter.eventType !== eventType) {
      return false;
    }

    return true;
  }

  buildCommandInput(
    payload: Record<string, any>,
    headers: Koa.Context['req']['headers'],
    filter: Record<string, any>,
  ): Record<string, any> {
    let eventType = (headers['x-github-event'] as string) ?? '';
    let realm = filter.realm as string | undefined;
    if (!realm) {
      throw new Error(
        'realm must be provided in the filter for github-event webhook commands',
      );
    }

    return {
      eventType,
      realm,
      payload,
    };
  }

  getRealmURL(filter: Record<string, any>, commandURL: string): string {
    return (
      (filter.realm as string | undefined) ??
      new URL('/submissions/', commandURL).href
    );
  }
}

/**
 * Default pass-through handler used when no filter type is specified or the
 * type is unrecognised. Always matches and passes the raw payload as the
 * command input.
 */
class DefaultFilterHandler implements WebhookFilterHandler {
  matches(): boolean {
    return true;
  }

  buildCommandInput(payload: Record<string, any>): Record<string, any> {
    return { payload };
  }

  getRealmURL(filter: Record<string, any>, commandURL: string): string {
    return (
      (filter.realmUrl as string | undefined) ?? new URL('/', commandURL).href
    );
  }
}

const filterHandlerRegistry: Record<string, WebhookFilterHandler> = {
  'github-event': new GithubEventFilterHandler(),
  default: new DefaultFilterHandler(),
};

/**
 * Look up the filter handler for the given filter configuration. The filter
 * should include a `type` key (e.g. `"github-event"`). When no type is
 * present the default pass-through handler is returned.
 */
export function getFilterHandler(
  filter: Record<string, any> | null,
): WebhookFilterHandler {
  let type = filter?.type as string | undefined;
  return (
    filterHandlerRegistry[type ?? 'default'] ?? filterHandlerRegistry.default
  );
}
