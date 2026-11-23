import { service } from '@ember/service';

import {
  AUTOMATION_ROUTE_REALM_PARAM,
  AUTOMATION_ROUTE_RUN_PARAM,
  AUTOMATION_RUN_REPORT_PATH,
} from '@cardstack/runtime-common/automation-routes';
import { automationRunLogURL } from '@cardstack/runtime-common/automation-run-log-follow';

import HostBaseTool from '../lib/host-base-tool';

import type RealmServerService from '../services/realm-server';
import type * as BaseToolModule from '@cardstack/base/command';

// What a card asks for: one run's report, or one page of the run's log.
//
// - `{ realm, run, read: 'report' }` reads `GET /_automation-run-report`.
// - `{ realm, run, read: 'log', after?, limit?, levels? }` reads one page of
//   `GET /_automation-run-log`, past the `seq` in `after`, keeping only the
//   levels in `levels` when given.
export interface ReadAutomationRunInput {
  realm: string;
  run: string;
  read: 'report' | 'log';
  after?: number;
  limit?: number;
  levels?: string[];
}

// What the tool answers: whether the realm server answered with success,
// its status, and the JSON:API document it served (`{}` for a refusal).
export interface ReadAutomationRunOutput {
  ok: boolean;
  status: number;
  body: Record<string, unknown>;
}

function inputOf(json: unknown): ReadAutomationRunInput {
  let input = (json ?? {}) as Partial<ReadAutomationRunInput>;
  if (typeof input.realm !== 'string' || !URL.canParse(input.realm)) {
    throw new Error('Reading an automation run needs the realm’s URL');
  }
  if (typeof input.run !== 'string' || input.run === '') {
    throw new Error('Reading an automation run needs the run’s id');
  }
  if (input.read !== 'report' && input.read !== 'log') {
    throw new Error(
      'Reading an automation run reads either its report or its log',
    );
  }
  for (let key of ['after', 'limit'] as const) {
    if (input[key] !== undefined && !Number.isInteger(input[key])) {
      throw new Error(`\`${key}\` must be a whole number`);
    }
  }
  if (
    input.levels !== undefined &&
    (!Array.isArray(input.levels) ||
      input.levels.some((level) => typeof level !== 'string'))
  ) {
    throw new Error('`levels` must be a list of log levels');
  }
  return input as ReadAutomationRunInput;
}

// Reads what the automations console shows of one run, from the realm
// server's console routes, with the viewer's realm-server session: the run's
// report (timings, milestones, calls, writes and cost) or a page of the run's
// log. A card's own fetch carries realm sessions only, so a card reaches
// these realm-server routes through this tool. The routes answer only a
// direct writer of the run's realm, so the tool reads nothing the viewer
// couldn't read with the viewer's own session.
export default class ReadAutomationRunTool extends HostBaseTool<
  typeof BaseToolModule.JsonCard,
  typeof BaseToolModule.JsonCard
> {
  @service declare private realmServer: RealmServerService;

  description =
    "Read an automation run's report, or a page of the run's log, as a direct writer of the run's realm";

  async getInputType() {
    let commandModule = await this.loadToolModule();
    return commandModule.JsonCard;
  }

  requireInputFields = ['json'];

  protected async run(
    input: BaseToolModule.JsonCard,
  ): Promise<BaseToolModule.JsonCard> {
    let { realm, run, read, after, limit, levels } = inputOf(input.json);
    let realmServerURL = this.realmServer.url.href;
    let url: string;
    if (read === 'report') {
      let reportURL = new URL(
        AUTOMATION_RUN_REPORT_PATH.slice(1),
        realmServerURL,
      );
      reportURL.searchParams.set(AUTOMATION_ROUTE_REALM_PARAM, realm);
      reportURL.searchParams.set(AUTOMATION_ROUTE_RUN_PARAM, run);
      url = reportURL.href;
    } else {
      url = automationRunLogURL({
        realmServerURL,
        realm,
        runId: run,
        after,
        limit,
        levels,
      });
    }
    let response = await this.realmServer.authedFetch(url, {
      headers: { Accept: 'application/json' },
    });
    let body: Record<string, unknown> = {};
    if (response.ok) {
      try {
        body = await response.json();
      } catch {
        body = {};
      }
    }
    let commandModule = await this.loadToolModule();
    let output: ReadAutomationRunOutput = {
      ok: response.ok,
      status: response.status,
      body,
    };
    return new commandModule.JsonCard({ json: output });
  }
}
