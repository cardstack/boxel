import type { CardContext } from './card-api';
import { isLiveRender } from './render-context';
import { subscribeToRealm } from '@cardstack/runtime-common';
import type {
  AutomationListDocument,
  AutomationSummaryResource,
  AutomationSummaryTrigger,
} from '@cardstack/runtime-common/automation-list';
import { Alert } from '@cardstack/pretui/components/alert';
import { Button } from '@cardstack/pretui/components/button';
import { Chip } from '@cardstack/pretui/components/chip';
import { Descriptions } from '@cardstack/pretui/components/descriptions';
import { EmptyState } from '@cardstack/pretui/components/empty-state';
import { FormatDate } from '@cardstack/pretui/components/format-date';
import { Item } from '@cardstack/pretui/components/item';
import { List } from '@cardstack/pretui/components/list';
import { Spinner } from '@cardstack/pretui/components/spinner';
import { Token } from '@cardstack/pretui/components/token';
import AuthedFetchTool from '@cardstack/boxel-host/tools/authed-fetch';
import OpenAutomationsConsoleTool from '@cardstack/boxel-host/tools/open-automations-console';
import { on } from '@ember/modifier';
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { restartableTask, task, timeout } from 'ember-concurrency';
import { modifier } from 'ember-modifier';

// Every automation in a realm at a glance, for the realm's direct writers.
// The realm config shows a distilled list (`RealmAutomations`), and the
// automations console shows the full one (`AutomationsConsole`). Both read
// the realm's `_automations` route, which answers only a direct writer, and
// read it again on each `job` and `automation` realm event, which reach only
// direct writers too, and on each index event, since a card edit changes the
// triggers and an added card adds an automation.

type Automation = AutomationSummaryResource;
type Tone = 'neutral' | 'success' | 'warning' | 'info';

// The route's path, as `AUTOMATION_LIST_PATH` in runtime-common's
// `automation-list.ts` names it. That module reads the database, so the card
// imports its types alone.
const AUTOMATION_LIST_PATH = '_automations';

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function count(n: number): string {
  return n.toLocaleString('en-US');
}

// A card with no name reads by the last segment of the card's URL.
export function automationTitle(automation: Automation): string {
  let { title } = automation.attributes;
  if (title) {
    return title;
  }
  let path = new URL(automation.id).pathname.replace(/\/$/, '');
  return decodeURIComponent(path.slice(path.lastIndexOf('/') + 1));
}

interface StateLook {
  label: string;
  tone: Tone;
}

// The automation's state as a chip. A run in progress reads as Running
// whatever the row's state, since the run is what a viewer watches.
export function automationStateLook(automation: Automation): StateLook {
  let { attributes } = automation;
  if (attributes.currentRun) {
    return { label: 'Running', tone: 'info' };
  }
  if (!attributes.switchedOn) {
    return { label: 'Off', tone: 'neutral' };
  }
  switch (attributes.state) {
    case 'paused':
      return { label: 'Paused', tone: 'warning' };
    case 'waiting-for-credits':
      return { label: 'Waiting for credits', tone: 'warning' };
    case 'done':
      return { label: 'Done', tone: 'neutral' };
    default:
      return { label: 'On', tone: 'success' };
  }
}

// Why Boxel paused the automation, by the reason the server records.
const PAUSED_BECAUSE: Record<string, string> = {
  requested: 'A workspace administrator paused the automation.',
  'caps-raised':
    'Boxel paused the automation because someone raised a limit above what the payer agreed to pay for.',
  'batched-ai-enabled':
    'Boxel paused the automation because someone turned on batched AI after the payer agreed to the limits.',
  'webhook-changed':
    'Boxel paused the automation because a trigger names an incoming webhook the payer didn’t agree to.',
  'payer-lost-access':
    'Boxel paused the automation because the payer can no longer edit this workspace.',
  'realm-archived':
    'Boxel paused the automation because someone archived this workspace.',
  'repeated-failures':
    'Boxel paused the automation after the automation’s runs failed several times in a row.',
  'invalid-declaration':
    'Boxel paused the automation because the automation’s settings have problems.',
};

export function pausedBecause(automation: Automation): string {
  let reason = automation.attributes.pauseReason;
  return (
    (reason && PAUSED_BECAUSE[reason]) ??
    'A workspace administrator paused the automation.'
  );
}

// Where a run in progress is: the milestone the script last reported, with
// the count inside the milestone when the script counts.
export function runningText(automation: Automation): string | undefined {
  let run = automation.attributes.currentRun;
  if (!run) {
    return undefined;
  }
  if (!run.milestone) {
    return 'Running, before the first milestone';
  }
  let progress =
    run.done !== undefined && run.total !== undefined
      ? ` (${count(run.done)} of ${count(run.total)})`
      : '';
  return `Running “${run.milestone}”${progress}`;
}

export function payerText(automation: Automation): string {
  let { attributes } = automation;
  if (!attributes.switchedOn) {
    return 'Nobody yet';
  }
  if (attributes.viewerIsPayer) {
    return 'You';
  }
  return attributes.payer ?? 'A person who shares no workspace with you';
}

export function lastResultText(automation: Automation): string {
  switch (automation.attributes.lastResult) {
    case 'complete':
      return 'Completed';
    case 'error':
      return 'Failed';
    case 'canceled':
      return 'Stopped';
    default:
      return 'No runs yet';
  }
}

export function spendText(automation: Automation): string {
  let { monthlyCredits, spentThisMonth } = automation.attributes;
  return monthlyCredits === null
    ? `${count(spentThisMonth)} credits this month, with no monthly limit`
    : `${count(spentThisMonth)} of ${count(monthlyCredits)} credits this month`;
}

// What the realm config's distilled row says under the automation's name.
function glanceText(automation: Automation): string | undefined {
  let { attributes } = automation;
  let running = runningText(automation);
  if (running) {
    return running;
  }
  if (!attributes.switchedOn) {
    return 'Nobody has turned the automation on';
  }
  switch (attributes.state) {
    case 'paused':
      return pausedBecause(automation);
    case 'waiting-for-credits':
      return 'The payer has no credits left, so Boxel holds every run';
    case 'done':
      return 'No runs left on any trigger';
    default:
      return attributes.nextRun ? undefined : 'No scheduled run';
  }
}

function triggerKindText(trigger: AutomationSummaryTrigger): string {
  switch (trigger.kind) {
    case 'cron':
      return 'Schedule';
    case 'once':
      return 'Once';
    case 'webhook':
      return 'Incoming webhook';
    default:
      return 'Trigger';
  }
}

interface ReaderSignature {
  Args: {
    // The realm's URL.
    realm: string | undefined;
    context: CardContext | undefined;
  };
}

// Reads the realm's automations and follows them live, for the two lists
// below. `visible` is false until the realm answers, and stays false for a
// viewer who isn't a direct writer of the realm, so neither list shows that
// viewer anything.
class AutomationsReader<
  S extends ReaderSignature = ReaderSignature,
> extends GlimmerComponent<S> {
  @tracked protected known = false;
  @tracked protected visible = false;
  @tracked protected automations: Automation[] = [];
  @tracked protected loadError: string | undefined;

  protected get toolContext() {
    return this.args.context?.toolContext;
  }

  protected follow = modifier((element, [realm]: [string | undefined]) => {
    if (!realm || !isLiveRender(element)) {
      return;
    }
    this.load.perform(realm);
    let unsubscribe = subscribeToRealm(realm, (event) => {
      if (
        event.eventName === 'job' ||
        event.eventName === 'automation' ||
        event.eventName === 'index'
      ) {
        this.load.perform(realm, { settle: true });
      }
    });
    return () => unsubscribe();
  });

  private load = restartableTask(
    async (realm: string, { settle = false }: { settle?: boolean } = {}) => {
      let toolContext = this.toolContext;
      if (!toolContext) {
        this.known = true;
        return;
      }
      if (settle) {
        // A run sends several events in quick succession (it starts, is
        // admitted, reaches each milestone), so a burst reads the list once.
        await timeout(250);
      }
      try {
        let result = await new AuthedFetchTool(toolContext).execute({
          url: `${realm}${AUTOMATION_LIST_PATH}`,
          acceptHeader: 'application/json',
        });
        if (result.ok) {
          let document = result.body as AutomationListDocument;
          this.automations = [...(document?.data ?? [])];
          this.visible = true;
          this.loadError = undefined;
        } else if (result.status === 401 || result.status === 403) {
          this.visible = false;
          this.automations = [];
        } else {
          // A read that failed for any reason but the viewer not being a
          // direct writer says so, rather than hiding the list.
          this.visible = true;
          this.loadError = `The workspace answered ${result.status}`;
        }
      } catch (err) {
        this.visible = true;
        this.loadError = errorText(err);
      }
      this.known = true;
    },
  );
}

interface RealmAutomationsSignature {
  Args: ReaderSignature['Args'];
}

// The realm config's Automations entry: each automation's name and state,
// with when it runs next, where its run is, or why it is paused, and a button
// that opens the full console. Shown only to the realm's direct writers.
export default class RealmAutomations extends AutomationsReader<RealmAutomationsSignature> {
  @tracked private openError: string | undefined;

  private openConsole = task(async () => {
    let toolContext = this.toolContext;
    let realm = this.args.realm;
    if (!toolContext || !realm) {
      return;
    }
    this.openError = undefined;
    try {
      await new OpenAutomationsConsoleTool(toolContext).execute({ realm });
    } catch (err) {
      this.openError = errorText(err);
    }
  });

  private openConsoleNow = () => {
    this.openConsole.perform();
  };

  private rowLabel = (automation: Automation) => automationTitle(automation);

  <template>
    <section
      class='realm-automations'
      data-test-realm-automations
      {{this.follow @realm}}
    >
      {{#if this.visible}}
        <header class='header'>
          <h2 class='section-title'>Automations</h2>
          <Button
            @tone='neutral'
            @appearance='outlined'
            @size='s'
            @busy={{this.openConsole.isRunning}}
            {{on 'click' this.openConsoleNow}}
            data-test-open-automations-console
          >
            Open console
          </Button>
        </header>
        {{#if this.loadError}}
          <Alert
            @tone='danger'
            @title='Boxel couldn’t read the automations'
            data-test-realm-automations-error
          >
            {{this.loadError}}
          </Alert>
        {{else if this.automations.length}}
          <List
            @items={{this.automations}}
            @label='Automations'
            @size='s'
            @bordered={{true}}
            @rowLabel={{this.rowLabel}}
            data-test-realm-automations-list
          >
            <:item as |automation|>
              <AutomationGlance @automation={{automation}} />
            </:item>
          </List>
        {{else}}
          <EmptyState
            @title='No automations'
            @size='s'
            data-test-realm-automations-empty
          >
            This workspace has no automation cards. Ask the AI assistant to
            write an automation, and Boxel lists the automation here.
          </EmptyState>
        {{/if}}
        {{#if this.openError}}
          <Alert @tone='danger' data-test-open-automations-console-error>
            {{this.openError}}
          </Alert>
        {{/if}}
      {{/if}}
    </section>
    <style scoped>
      .realm-automations {
        display: grid;
        gap: var(--boxel-sp-xs);
      }
      .realm-automations:empty {
        display: none;
      }
      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--boxel-sp-xs);
      }
      .section-title {
        font-weight: 600;
        font-size: var(--boxel-font-size);
        margin: 0;
      }
    </style>
  </template>
}

interface AutomationGlanceSignature {
  Args: { automation: Automation };
}

// One automation in the realm config's list: name, state, and one line on
// what happens next.
class AutomationGlance extends GlimmerComponent<AutomationGlanceSignature> {
  private get look() {
    return automationStateLook(this.args.automation);
  }

  private get glance() {
    return glanceText(this.args.automation);
  }

  private get nextRun() {
    let { attributes } = this.args.automation;
    return !attributes.currentRun &&
      attributes.switchedOn &&
      attributes.state !== 'paused' &&
      attributes.state !== 'done'
      ? (attributes.nextRun ?? undefined)
      : undefined;
  }

  <template>
    <Item
      @title={{automationTitle @automation}}
      @wrap={{true}}
      data-test-realm-automation={{@automation.id}}
    >
      <:description>
        {{#if this.nextRun}}
          Next run
          <FormatDate
            @date={{this.nextRun}}
            @dateStyle='medium'
            @timeStyle='short'
            data-test-realm-automation-next-run
          />
        {{else}}
          <span data-test-realm-automation-glance>{{this.glance}}</span>
        {{/if}}
      </:description>
      <:trailing>
        <Chip
          @tone={{this.look.tone}}
          data-test-realm-automation-state={{this.look.label}}
        >
          {{#if @automation.attributes.currentRun}}
            <Spinner @size='xs' aria-hidden='true' />
          {{/if}}
          {{this.look.label}}
        </Chip>
      </:trailing>
    </Item>
  </template>
}

interface AutomationsConsoleSignature {
  Args: ReaderSignature['Args'];
}

// The automations console's list: each automation in full, with its
// triggers, next run in the viewer's own time, payer, monthly cap and this
// month's spend, last result, and the milestone a running automation is in.
export class AutomationsConsole extends AutomationsReader<AutomationsConsoleSignature> {
  private rowLabel = (automation: Automation) => automationTitle(automation);

  <template>
    <div
      class='automations-console'
      data-test-automations-console
      {{this.follow @realm}}
    >
      {{#if this.visible}}
        {{#if this.loadError}}
          <Alert
            @tone='danger'
            @title='Boxel couldn’t read the automations'
            data-test-automations-console-error
          >
            {{this.loadError}}
          </Alert>
        {{else if this.automations.length}}
          <List
            @items={{this.automations}}
            @label='Automations'
            @rowLabel={{this.rowLabel}}
            data-test-automations-console-list
          >
            <:item as |automation|>
              <AutomationDetail @automation={{automation}} />
            </:item>
          </List>
        {{else}}
          <EmptyState
            @title='No automations'
            data-test-automations-console-empty
          >
            This workspace has no automation cards. Ask the AI assistant to
            write an automation, and Boxel lists the automation here.
          </EmptyState>
        {{/if}}
      {{else if this.known}}
        <Alert
          @tone='info'
          @title='Only workspace administrators see automations'
          data-test-automations-console-not-visible
        >
          A person who directly edits this workspace sees each automation, who
          pays for the automation, and the automation’s runs.
        </Alert>
      {{else}}
        <Spinner aria-label='Reading the automations' />
      {{/if}}
    </div>
    <style scoped>
      .automations-console {
        display: grid;
        gap: var(--boxel-sp);
      }
    </style>
  </template>
}

interface AutomationDetailSignature {
  Args: { automation: Automation };
}

class AutomationDetail extends GlimmerComponent<AutomationDetailSignature> {
  private get look() {
    return automationStateLook(this.args.automation);
  }

  private get attributes() {
    return this.args.automation.attributes;
  }

  private get statusText() {
    let running = runningText(this.args.automation);
    if (running) {
      return running;
    }
    return this.attributes.switchedOn && this.attributes.state === 'paused'
      ? pausedBecause(this.args.automation)
      : undefined;
  }

  private get nextRun() {
    return this.attributes.nextRun ?? undefined;
  }

  private get nextRunText() {
    if (!this.attributes.switchedOn) {
      return 'None while the automation is off';
    }
    if (this.attributes.state === 'paused') {
      return 'None while paused';
    }
    return this.attributes.nextRun ? undefined : 'None';
  }

  private get items() {
    return [
      { key: 'triggers', label: 'Triggers', span: 'fill' as const },
      { key: 'next-run', label: 'Next run' },
      { key: 'payer', label: 'Payer', value: payerText(this.args.automation) },
      {
        key: 'spend',
        label: 'Spending',
        value: spendText(this.args.automation),
      },
      { key: 'last-run', label: 'Last run' },
    ];
  }

  <template>
    <Item
      @title={{automationTitle @automation}}
      @wrap={{true}}
      @alignStart={{true}}
      data-test-automations-console-automation={{@automation.id}}
    >
      <:description>
        {{#if this.statusText}}
          <span data-test-automations-console-status>{{this.statusText}}</span>
        {{/if}}
      </:description>
      <:trailing>
        <Chip
          @tone={{this.look.tone}}
          data-test-automations-console-state={{this.look.label}}
        >
          {{#if this.attributes.currentRun}}
            <Spinner @size='xs' aria-hidden='true' />
          {{/if}}
          {{this.look.label}}
        </Chip>
      </:trailing>
      <:default>
        <Descriptions @items={{this.items}} @columns={{2}} @size='s'>
          <:value as |item|>
            {{#if (isKey item 'triggers')}}
              {{#if this.attributes.triggers.length}}
                <ul class='triggers' data-test-automations-console-triggers>
                  {{#each this.attributes.triggers as |trigger|}}
                    <li class='trigger'>
                      <span class='trigger-label'>{{trigger.label}}</span>
                      <span class='trigger-kind'>{{triggerKindText
                          trigger
                        }}</span>
                      {{#if trigger.expression}}
                        <Token @value={{trigger.expression}} />
                      {{/if}}
                      {{#if trigger.date}}
                        <span>{{trigger.date}}
                          {{trigger.time}}</span>
                      {{/if}}
                      {{#if trigger.timeZone}}
                        <span class='trigger-zone'>{{trigger.timeZone}}</span>
                      {{/if}}
                      {{#if trigger.webhookPath}}
                        <Token @value={{trigger.webhookPath}} />
                      {{/if}}
                    </li>
                  {{/each}}
                </ul>
              {{else}}
                No triggers
              {{/if}}
            {{else if (isKey item 'next-run')}}
              {{#if this.nextRunText}}
                {{this.nextRunText}}
              {{else}}
                <FormatDate
                  @date={{this.nextRun}}
                  @dateStyle='medium'
                  @timeStyle='short'
                  data-test-automations-console-next-run
                />
              {{/if}}
            {{else if (isKey item 'last-run')}}
              <span data-test-automations-console-last-result>
                {{lastResultText @automation}}
              </span>
              {{#if this.attributes.lastFinishedAt}}
                <FormatDate
                  @date={{this.attributes.lastFinishedAt}}
                  @dateStyle='medium'
                  @timeStyle='short'
                />
              {{/if}}
            {{else}}
              <span data-test-automations-console-value={{item.key}}>
                {{item.value}}
              </span>
            {{/if}}
          </:value>
        </Descriptions>
      </:default>
    </Item>
    <style scoped>
      .triggers {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: var(--boxel-sp-5xs);
      }
      .trigger {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: var(--boxel-sp-4xs);
      }
      .trigger-label {
        font-weight: 600;
      }
      .trigger-kind,
      .trigger-zone {
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

function isKey(item: { key?: string }, key: string): boolean {
  return item.key === key;
}
