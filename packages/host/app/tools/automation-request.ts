import { service } from '@ember/service';

import HostBaseTool, { type ClickReason } from '../lib/host-base-tool';

import type RealmServerService from '../services/realm-server';
import type * as BaseToolModule from '@cardstack/base/command';

// The prefix every route this tool may call starts with: the realm server's
// automation routes, which act as the session's own user and answer only a
// direct writer of the realm the request names.
const ROUTE_PREFIX = '_automation-';

// The routes about one run name it in the body by `automation-run`; the rest
// name the Automation card by `automation`.
const RUN_BODY_ROUTES = new Set(['_automation-run-cancel']);

// Calls one of the realm server's automation routes for a card, such as the
// Automation card's Preview, Run now, Pause, Resume, Remove and Cancel
// buttons, and the reads behind its run report, staged files and storage.
// The request carries the realm-server session, which those routes take,
// rather than a realm's token.
export default class AutomationRequestTool extends HostBaseTool<
  typeof BaseToolModule.AutomationRequestInput,
  typeof BaseToolModule.AutomationRequestResult
> {
  @service declare private realmServer: RealmServerService;

  static actionVerb = 'Request';

  description =
    "Call one of the realm server's automation routes (route, such as _automation-pause) for an automation (automation) in a workspace (realm), as the signed-in user. Only the workspace's direct writers may.";

  // A GET only reads. Any other method starts a run, or changes or removes
  // the automation, so a call waits for the user's click.
  static clickReasonsFor(
    attributes: Record<string, unknown> | undefined,
  ): ClickReason[] {
    let method = String(attributes?.method ?? 'GET').toUpperCase();
    return method === 'GET'
      ? []
      : [
          {
            call: String(attributes?.route ?? ROUTE_PREFIX),
            reason:
              'The request starts a run of the automation, or changes or removes the automation.',
          },
        ];
  }

  async getInputType() {
    let commandModule = await this.loadToolModule();
    const { AutomationRequestInput } = commandModule;
    return AutomationRequestInput;
  }

  requireInputFields = ['route', 'realm'];

  protected async run(
    input: BaseToolModule.AutomationRequestInput,
  ): Promise<BaseToolModule.AutomationRequestResult> {
    let commandModule = await this.loadToolModule();
    const { AutomationRequestResult } = commandModule;
    let route = (input.route ?? '').replace(/^\//, '');
    if (!route.startsWith(ROUTE_PREFIX) || !/^[a-z-]+$/.test(route)) {
      throw new Error(
        `AutomationRequestTool calls only the realm server's ${ROUTE_PREFIX} routes, not "${input.route}"`,
      );
    }
    let method = (input.method ?? 'GET').toUpperCase();
    let url = new URL(route, this.realmServer.url);
    let init: RequestInit = { method, headers: { Accept: 'application/json' } };
    if (method === 'GET') {
      let params: [string, string | undefined | null][] = [
        ['realm', input.realm],
        ['automation', input.automation],
        ['run', input.run],
        ['path', input.filePath],
      ];
      for (let [name, value] of params) {
        if (value) {
          url.searchParams.set(name, value);
        }
      }
    } else {
      let attributes: Record<string, unknown> = { realm: input.realm };
      if (input.monthlyCredits != null) {
        attributes.monthlyCredits = input.monthlyCredits;
      }
      if (input.click) {
        attributes.click = input.click;
      }
      let forRun = RUN_BODY_ROUTES.has(route);
      init.headers = {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      };
      init.body = JSON.stringify({
        data: {
          type: forRun ? 'automation-run' : 'automation',
          id: forRun ? input.run : input.automation,
          attributes,
        },
      });
    }
    let response = await this.realmServer.authedFetch(url.href, init);
    let text = await response.text();
    let body: Record<string, any> | undefined;
    let isJSON = /json/.test(response.headers.get('Content-Type') ?? '');
    if (isJSON || !response.ok) {
      try {
        body = JSON.parse(text);
      } catch {
        body = undefined;
      }
    }
    let errors = Array.isArray(body?.errors)
      ? body!.errors.map((e: unknown) =>
          typeof e === 'string'
            ? e
            : String((e as { detail?: string })?.detail ?? e),
        )
      : [];
    return new AutomationRequestResult({
      ok: response.ok,
      status: response.status,
      body: body ?? {},
      text: body ? undefined : text,
      errors,
    });
  }
}
