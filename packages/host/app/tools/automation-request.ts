import { service } from '@ember/service';

import {
  AUTOMATION_RESOURCE_TYPE,
  AUTOMATION_ROUTE_AUTOMATION_PARAM,
  AUTOMATION_ROUTE_PATH_PARAM,
  AUTOMATION_ROUTE_REALM_PARAM,
  AUTOMATION_ROUTE_RUN_PARAM,
  AUTOMATION_RUN_CANCEL_PATH,
  AUTOMATION_RUN_RESOURCE_TYPE,
} from '@cardstack/runtime-common/automation-routes';

import HostBaseTool, { type ClickReason } from '../lib/host-base-tool';

import type RealmServerService from '../services/realm-server';
import type * as BaseToolModule from '@cardstack/base/command';

// The prefix every route this tool may call starts with: the realm server's
// automation routes, which act as the session's own user and answer only a
// direct writer of the realm the request names.
const ROUTE_PREFIX = '_automation-';
const ROUTE_PATTERN = /^_automation-[a-z-]+$/;

// The routes about one run name it in the body by `automation-run`; the rest
// name the Automation card by `automation`.
const RUN_BODY_ROUTES = new Set([AUTOMATION_RUN_CANCEL_PATH.slice(1)]);

// Calls one of the realm server's automation routes for a card: the
// Automation card's switch-on screen, and the console's Preview, Run now,
// Pause, Resume, Remove and Cancel buttons and the reads behind its run
// report, staged files and storage. The request carries the realm-server
// session, which those routes take, rather than a realm's token.
//
// Card code calls this tool, as it calls `authed-fetch`. It isn't one of the
// assistant's workspace capabilities (ADR 022 §1.1): no skill offers it to the
// model, so the assistant reaches automations through the Realm Runner. Should
// a skill ever name it, every call but a GET waits for the person's click.
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
    if (!ROUTE_PATTERN.test(route)) {
      throw new Error(
        `AutomationRequestTool calls only the realm server's ${ROUTE_PREFIX} routes, not "${input.route}"`,
      );
    }
    let method = (input.method ?? 'GET').toUpperCase();
    let url = new URL(route, this.realmServer.url);
    let init: RequestInit = { method, headers: { Accept: 'application/json' } };
    if (method === 'GET') {
      let params: [string, string | undefined | null][] = [
        [AUTOMATION_ROUTE_REALM_PARAM, input.realm],
        [AUTOMATION_ROUTE_AUTOMATION_PARAM, input.automation],
        [AUTOMATION_ROUTE_RUN_PARAM, input.run],
        [AUTOMATION_ROUTE_PATH_PARAM, input.filePath],
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
          type: forRun
            ? AUTOMATION_RUN_RESOURCE_TYPE
            : AUTOMATION_RESOURCE_TYPE,
          id: forRun ? input.run : input.automation,
          attributes,
        },
      });
    }
    let response = await this.realmServer.authedFetch(url.href, init);
    let bytes = new Uint8Array(await response.arrayBuffer());
    let body: Record<string, any> | undefined;
    let isJSON = /json/.test(response.headers.get('Content-Type') ?? '');
    if (isJSON || !response.ok) {
      try {
        body = JSON.parse(new TextDecoder().decode(bytes));
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
      // An answer that isn't JSON, such as a Preview's staged file, is the
      // script's bytes, which may not be text.
      bytesBase64: body ? undefined : base64Of(bytes),
      errors,
    });
  }
}

function base64Of(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}
