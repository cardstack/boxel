import { getComponent, type CardContext, type CreateCardFn } from './card-api';
import { isLiveRender } from './render-context';
import {
  realmConfigCardURL,
  rri,
  subscribeToRealm,
  type ResolvedCodeRef,
  type ToolContext,
} from '@cardstack/runtime-common';
import type {
  AutomationListDocument,
  AutomationSummaryResource,
} from '@cardstack/runtime-common/automation-list';
import { cn } from '@cardstack/boxel-ui/helpers';
import { Alert } from '@cardstack/pretui/components/alert';
import { Button } from '@cardstack/pretui/components/button';
import { Chip } from '@cardstack/pretui/components/chip';
import { EmptyState } from '@cardstack/pretui/components/empty-state';
import { FormatDate } from '@cardstack/pretui/components/format-date';
import { Item } from '@cardstack/pretui/components/item';
import { List } from '@cardstack/pretui/components/list';
import { Spinner } from '@cardstack/pretui/components/spinner';
import PlusIcon from '@cardstack/boxel-icons/plus';
import AuthedFetchTool from '@cardstack/boxel-host/tools/authed-fetch';
import ShowCardTool from '@cardstack/boxel-host/tools/show-card';
import { on } from '@ember/modifier';
import { schedule } from '@ember/runloop';
import type Owner from '@ember/owner';
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { restartableTask, task, timeout } from 'ember-concurrency';
import { modifier } from 'ember-modifier';
import { provide } from 'ember-provide-consume-context';

// The automations console: the realm config's Automations section, every
// automation in the realm for the realm's direct writers. It reads the
// realm's `_automations` route, which answers only a direct writer, and reads
// it again on each `job` and `automation` realm event, which reach only
// direct writers too, and on each index event, since a card edit changes the
// triggers and an added card adds an automation.

type Automation = AutomationSummaryResource;
type Tone = 'neutral' | 'success' | 'warning' | 'info';

// The route's path, as `AUTOMATION_LIST_PATH` in runtime-common's
// `automation-list.ts` names it. That module reads the database, so the card
// imports its types alone.
const AUTOMATION_LIST_PATH = '_automations';

// The catalog's Automation type, as `automationRef` in runtime-common's
// `automation-declaration.ts` names it.
const AUTOMATION_TYPE: ResolvedCodeRef = {
  module: rri('@cardstack/catalog/automation/automation'),
  name: 'Automation',
};

// Provided to everything the console lists, as `true`, so an automation's own
// views can tell they already show in the console and leave out the way into
// the console.
export const AutomationsConsoleContextName = 'automations-console-context';

// The automation `showAutomationInConsole` asks the realm's next console to
// reveal. Only a console that mounts after the request takes it, once, as the
// console mounts: consoles already open, including ones buried in a stack,
// never see it, so the config card the request opens is the one that reveals
// the automation. Plain state rather than tracked, since nothing re-renders
// when it changes.
let consoleRequest: { realm: string; automation: string } | undefined;

function takeConsoleRequest(realm: string | undefined): string | undefined {
  if (!realm || consoleRequest?.realm !== withSlash(realm)) {
    return undefined;
  }
  let { automation } = consoleRequest;
  consoleRequest = undefined;
  return automation;
}

function withSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

// Opens the realm's config card on its Automations section with the given
// automation's row in view and marked, so the automation's own card leads
// to the console that lists the automation. `realm` is the realm's URL and
// `automation` the automation card's id.
export async function showAutomationInConsole(
  toolContext: ToolContext,
  realm: string,
  automation: string,
): Promise<void> {
  let request = { realm: withSlash(realm), automation };
  consoleRequest = request;
  try {
    await new ShowCardTool(toolContext).execute({
      cardId: realmConfigCardURL(new URL(request.realm)).href,
      format: 'isolated',
    });
  } catch (error) {
    // The config card mounts its console once the card loads, after the tool
    // returns, and that console takes the request. A config card that never
    // opened mounts no console, so its request is dropped here rather than
    // surfacing in a console opened later for another reason.
    if (consoleRequest === request) {
      consoleRequest = undefined;
    }
    throw error;
  }
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
  // A running automation's chip shows a spinner in place of the dot.
  dot: boolean;
}

// The automation's state as a chip. A run in progress reads as Running
// whatever the row's state, since the run is what a viewer watches.
export function automationStateLook(automation: Automation): StateLook {
  let { attributes } = automation;
  if (attributes.currentRun) {
    return { label: 'Running', tone: 'info', dot: false };
  }
  if (!attributes.switchedOn) {
    return { label: 'Off', tone: 'neutral', dot: true };
  }
  switch (attributes.state) {
    case 'paused':
      return { label: 'Paused', tone: 'warning', dot: true };
    case 'waiting-for-credits':
      return { label: 'Waiting for credits', tone: 'warning', dot: true };
    case 'waiting-for-key-approval':
      return { label: 'Waiting for key approval', tone: 'warning', dot: true };
    case 'done':
      return { label: 'Done', tone: 'neutral', dot: true };
    default:
      return { label: 'On', tone: 'success', dot: true };
  }
}

// Why Boxel paused the automation, by the reason the server records.
const PAUSED_BECAUSE: Record<string, string> = {
  requested: 'A person who edits this workspace paused the automation.',
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
    'A person who edits this workspace paused the automation.'
  );
}

// Where a run in progress is: the milestone the script last reported, with
// the last task the script reported inside the milestone.
export function runningText(automation: Automation): string | undefined {
  let run = automation.attributes.currentRun;
  if (!run) {
    return undefined;
  }
  if (!run.milestone) {
    return 'Running, before the first milestone';
  }
  let task = run.task ? ` — ${run.task}` : '';
  return `Running “${run.milestone}”${task}`;
}

// What a row says under the automation's name when the automation's card
// doesn't load.
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
    case 'waiting-for-key-approval':
      return 'Boxel holds every run until someone approves the automation’s use of each key';
    case 'done':
      return 'No runs left on any trigger';
    default:
      return attributes.nextRun ? undefined : 'No scheduled run';
  }
}

interface RealmAutomationsSignature {
  Args: {
    // The realm's URL.
    realm: string | undefined;
    context: CardContext | undefined;
    // The stack's `createCard`, which makes a card in the store and opens it
    // in the stack the realm config is in. Without one, there's no New
    // automation button.
    createCard?: CreateCardFn;
  };
}

// The realm config's Automations section, the automations console: each
// automation as the Automation card's fitted view, which shows its state,
// triggers, next run in the viewer's own time, last result, the milestone a
// running automation is in, its payer, and its limits against what it spent,
// with a button that makes a new automation. The section stays empty until
// the realm answers, and stays empty for a viewer who isn't a direct writer
// of the realm.
export default class RealmAutomations extends GlimmerComponent<RealmAutomationsSignature> {
  @tracked private visible = false;
  @tracked private automations: Automation[] = [];
  @tracked private loadFailed = false;
  @tracked private createFailed = false;
  // The automation an automation card opened the console on, which the
  // console marks until someone opens another automation from the list.
  @tracked private focused: string | undefined;
  // The same automation, until the console has listed the automation and
  // scrolled the automation's row into view.
  private toReveal: string | undefined;

  constructor(owner: Owner, args: RealmAutomationsSignature['Args']) {
    super(owner, args);
    this.toReveal = takeConsoleRequest(args.realm);
  }

  @provide(AutomationsConsoleContextName)
  get inConsole(): boolean {
    return true;
  }

  private get toolContext() {
    return this.args.context?.toolContext;
  }

  private follow = modifier((element, [realm]: [string | undefined]) => {
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
          // The route lists nothing to a viewer who isn't a direct writer,
          // and says so, so that viewer sees no section.
          this.visible = document?.meta?.directWriter === true;
          this.automations = this.visible ? [...(document?.data ?? [])] : [];
          this.loadFailed = false;
        } else if (result.status === 401 || result.status === 403) {
          this.visible = false;
          this.automations = [];
          this.loadFailed = false;
        } else {
          // A failed read says so with a way to try again, but only in a
          // section already showing: until the realm says the viewer is a
          // direct writer, the viewer sees no section at all.
          this.loadFailed = true;
        }
      } catch {
        this.loadFailed = true;
      }
    },
  );

  // Makes a new automation in the realm through the store, with no round
  // trip through the realm's index, and opens it in its edit view in the
  // realm config's own stack. The edit view fills the limits a new automation
  // starts with, and the person names it and writes its script and triggers
  // there.
  private createAutomation = task(async () => {
    let realm = this.args.realm;
    if (!realm || !this.args.createCard) {
      return;
    }
    this.createFailed = false;
    try {
      await this.args.createCard(AUTOMATION_TYPE, undefined, {
        realmURL: new URL(realm),
        cardModeAfterCreation: 'edit',
      });
    } catch {
      this.createFailed = true;
    }
  });

  private newAutomation = () => {
    this.createAutomation.perform();
  };

  private retryLoad = () => {
    if (this.args.realm) {
      this.load.perform(this.args.realm);
    }
  };

  private rowLabel = (automation: Automation) => automationTitle(automation);

  // A click on an automation, or Enter on its row, opens the automation's
  // card in its isolated view.
  private openAutomation = (automation: Automation) => {
    if (this.focused !== automation.id) {
      this.focused = undefined;
    }
    this.openCard.perform(automation.id);
  };

  private isFocused = (automation: Automation) =>
    this.focused === automation.id;

  // When this console opened for one of the listed automations, scrolls that
  // automation's row into view, moves the list's focus to the row, and marks
  // the row, once.
  private reveal = modifier((element: HTMLElement, [id]: [string]) => {
    if (this.toReveal !== id) {
      return;
    }
    // After the render that installed the modifier, so marking the row never
    // updates state that render read.
    let removed = false;
    schedule('afterRender', () => {
      if (removed || this.toReveal !== id) {
        return;
      }
      this.toReveal = undefined;
      this.focused = id;
      element.scrollIntoView({ block: 'center' });
      (element.closest('li') as HTMLElement | null)?.focus({
        preventScroll: true,
      });
    });
    return () => {
      removed = true;
    };
  });

  private openCard = task(async (cardId: string) => {
    let toolContext = this.toolContext;
    if (!toolContext) {
      return;
    }
    await new ShowCardTool(toolContext).execute({ cardId, format: 'isolated' });
  });

  <template>
    <section
      class='realm-automations'
      data-test-realm-automations
      {{this.follow @realm}}
    >
      {{#if this.visible}}
        <header class='header'>
          <h2 class='section-title'>Automations</h2>
          {{#if @createCard}}
            {{! Styled like the realm config's other section actions, such as
                "Share one of my keys". }}
            <Button
              @tone='primary'
              @appearance='accent'
              @size='s'
              @icon={{PlusIcon}}
              @busy={{this.createAutomation.isRunning}}
              {{on 'click' this.newAutomation}}
              data-test-new-automation
            >
              New automation
            </Button>
          {{/if}}
        </header>
        {{#if this.createFailed}}
          <Alert
            @tone='danger'
            @title='Boxel couldn’t make the automation'
            data-test-new-automation-error
          >
            <:default>Check your connection, then try again.</:default>
            <:action>
              <Button
                @size='s'
                @busy={{this.createAutomation.isRunning}}
                {{on 'click' this.newAutomation}}
                data-test-new-automation-retry
              >
                Try again
              </Button>
            </:action>
          </Alert>
        {{/if}}
        {{#if this.loadFailed}}
          <Alert
            @tone='danger'
            @title='Boxel couldn’t read the automations'
            data-test-realm-automations-error
          >
            <:default>Check your connection, then try again.</:default>
            <:action>
              <Button
                @size='s'
                @busy={{this.load.isRunning}}
                {{on 'click' this.retryLoad}}
                data-test-realm-automations-retry
              >
                Try again
              </Button>
            </:action>
          </Alert>
        {{else if this.automations.length}}
          <List
            @items={{this.automations}}
            @label='Automations'
            @rowLabel={{this.rowLabel}}
            @divided={{false}}
            @onActivate={{this.openAutomation}}
            data-test-realm-automations-list
          >
            <:item as |automation|>
              <AutomationSlot
                @automation={{automation}}
                @context={{@context}}
                @focused={{this.isFocused automation}}
                {{this.reveal automation.id}}
              />
            </:item>
          </List>
        {{else}}
          <EmptyState
            @title='No automations'
            @size='s'
            data-test-realm-automations-empty
          >
            This workspace has no automation cards. Make an automation with New
            automation, or ask the AI assistant to write an automation, and
            Boxel lists the automation here.
          </EmptyState>
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

// One automation whose card doesn't load: name, state, and one line on what
// happens next.
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
      attributes.state === 'active'
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
          @dot={{this.look.dot}}
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

interface AutomationSlotSignature {
  Args: {
    automation: Automation;
    context: CardContext | undefined;
    // Whether an automation card opened the console on this automation.
    focused?: boolean;
  };
  Element: HTMLDivElement;
}

// One automation as the Automation card's own fitted view. A card that
// doesn't load (a switched-on automation whose card the index lacks, say)
// shows a one-line summary from the realm's list instead.
class AutomationSlot extends GlimmerComponent<AutomationSlotSignature> {
  private cardResource = this.args.context?.getCard(
    this,
    () => this.args.automation.id,
  );

  private get card() {
    return this.cardResource?.card;
  }

  <template>
    <div
      class={{cn 'slot' slot--marked=@focused}}
      data-test-automation-slot={{@automation.id}}
      data-test-automation-slot-focused={{if @focused 'true'}}
      ...attributes
    >
      {{#if this.card}}
        {{#let (getComponent this.card) as |Card|}}
          <Card
            class='fitted'
            @format='fitted'
            @displayContainer={{true}}
            data-test-automation-slot-fitted
          />
        {{/let}}
      {{else}}
        <AutomationGlance @automation={{@automation}} />
      {{/if}}
    </div>
    <style scoped>
      .slot {
        container-type: inline-size;
        border-radius: var(--radius);
      }
      /* The automation an automation card opened the console on, in the
         theme's selected tint, so the row stands out among the others and
         never reads as the list's keyboard focus. */
      .slot--marked,
      .slot--marked .fitted {
        background-color: var(--selected);
      }
      /* The section's slot: as wide as the section, and tall enough for the
         card's state, first trigger, milestones, payer, spend and limits. */
      .fitted {
        inline-size: 100%;
        block-size: 6.5625rem;
      }
    </style>
  </template>
}
