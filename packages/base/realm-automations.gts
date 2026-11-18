import { getComponent, type CardContext } from './card-api';
import { isLiveRender } from './render-context';
import {
  rri,
  subscribeToRealm,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';
import type {
  AutomationListDocument,
  AutomationSummaryResource,
} from '@cardstack/runtime-common/automation-list';
import { Alert } from '@cardstack/pretui/components/alert';
import { Button } from '@cardstack/pretui/components/button';
import { Chip } from '@cardstack/pretui/components/chip';
import { EmptyState } from '@cardstack/pretui/components/empty-state';
import { Form } from '@cardstack/pretui/components/form';
import { FormField } from '@cardstack/pretui/components/form-field';
import { Input } from '@cardstack/pretui/components/input';
import { FormatDate } from '@cardstack/pretui/components/format-date';
import { Item } from '@cardstack/pretui/components/item';
import { List } from '@cardstack/pretui/components/list';
import { Spinner } from '@cardstack/pretui/components/spinner';
import PlusIcon from '@cardstack/boxel-icons/plus';
import AuthedFetchTool from '@cardstack/boxel-host/tools/authed-fetch';
import InvokeCardOperationTool from '@cardstack/boxel-host/tools/invoke-card-operation';
import ShowCardTool from '@cardstack/boxel-host/tools/show-card';
import { on } from '@ember/modifier';
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { restartableTask, task, timeout } from 'ember-concurrency';
import { modifier } from 'ember-modifier';

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
// `automation-declaration.ts` names it, and the operation the type declares
// for a new automation, which takes the automation's name.
const AUTOMATION_TYPE: ResolvedCodeRef = {
  module: rri('@cardstack/catalog/automation/automation'),
  name: 'Automation',
};
const NEW_AUTOMATION_OPERATION = 'newAutomation';

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
  @tracked private loadError: string | undefined;
  @tracked private creating = false;

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
    },
  );

  private startCreating = () => {
    this.creating = true;
  };

  private stopCreating = () => {
    this.creating = false;
  };

  private rowLabel = (automation: Automation) => automationTitle(automation);

  // A click on an automation, or Enter on its row, opens the automation's
  // card in its isolated view.
  private openAutomation = (automation: Automation) => {
    this.openCard.perform(automation.id);
  };

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
          {{#unless this.creating}}
            {{! Styled like the realm config's other section actions, such as
                "Share one of my keys". }}
            <Button
              @tone='primary'
              @appearance='accent'
              @size='s'
              @icon={{PlusIcon}}
              {{on 'click' this.startCreating}}
              data-test-new-automation-start
            >
              New automation
            </Button>
          {{/unless}}
        </header>
        {{#if this.creating}}
          <NewAutomationForm
            @realm={{@realm}}
            @context={{@context}}
            @onDone={{this.stopCreating}}
          />
        {{/if}}
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
            @rowLabel={{this.rowLabel}}
            @divided={{false}}
            @onActivate={{this.openAutomation}}
            data-test-realm-automations-list
          >
            <:item as |automation|>
              <AutomationSlot
                @automation={{automation}}
                @context={{@context}}
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
  };
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
    <div class='slot' data-test-automation-slot={{@automation.id}}>
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

interface NewAutomationFormSignature {
  Args: {
    realm: string | undefined;
    context: CardContext | undefined;
    // Called when the person cancels, or once the new card opens.
    onDone: () => void;
  };
}

// Makes a new automation in the realm through the Automation type's
// `newAutomation` operation, which takes only the automation's name, then
// opens the new card in its edit view, where the person writes the script,
// the triggers and the limits.
class NewAutomationForm extends GlimmerComponent<NewAutomationFormSignature> {
  @tracked private name = '';
  @tracked private error: string | undefined;

  private get nameMissing() {
    return !this.name.trim();
  }

  private cancel = () => {
    this.args.onDone();
  };

  private setName = (value: string) => {
    this.name = value;
  };

  private create = task(async () => {
    let toolContext = this.args.context?.toolContext;
    let realm = this.args.realm;
    let name = this.name.trim();
    if (!toolContext || !realm || !name) {
      return;
    }
    this.error = undefined;
    try {
      let result = await new InvokeCardOperationTool(toolContext).execute({
        type: AUTOMATION_TYPE,
        operation: NEW_AUTOMATION_OPERATION,
        realm,
        payload: { name },
      });
      if (!result.cardId) {
        throw new Error('The workspace made no automation card');
      }
      await new ShowCardTool(toolContext).execute({
        cardId: result.cardId,
        format: 'edit',
      });
      this.args.onDone();
    } catch (err) {
      this.error = errorText(err);
    }
  });

  private submit = (event: Event) => {
    event.preventDefault();
    this.create.perform();
  };

  <template>
    <div class='new-automation' data-test-new-automation>
      <Form
        @label='New automation'
        @busy={{this.create.isRunning}}
        @onSubmit={{this.submit}}
        data-test-new-automation-form
      >
        <:default>
          <FormField
            @label='Name'
            @required={{true}}
            @description='Boxel makes the automation card, then opens the card so you can write the script, the triggers and the limits.'
          >
            <:control as |ctx|>
              <Input
                @controlId={{ctx.id}}
                @describedBy={{ctx.describedBy}}
                @value={{this.name}}
                @onInput={{this.setName}}
                placeholder='Weekly digest'
                data-test-new-automation-name
              />
            </:control>
          </FormField>
          {{#if this.error}}
            <Alert
              @tone='danger'
              @title='Boxel couldn’t make the automation'
              data-test-new-automation-error
            >
              {{this.error}}
            </Alert>
          {{/if}}
        </:default>
        <:footer>
          <div class='actions'>
            <Button
              @variant='secondary'
              {{on 'click' this.cancel}}
              data-test-new-automation-cancel
            >
              Cancel
            </Button>
            <Button
              @variant='primary'
              type='submit'
              @busy={{this.create.isRunning}}
              @disabled={{this.nameMissing}}
              data-test-new-automation-create
            >
              Create automation
            </Button>
          </div>
        </:footer>
      </Form>
    </div>
    <style scoped>
      .new-automation {
        display: grid;
      }
      .actions {
        display: flex;
        justify-content: flex-end;
        gap: var(--boxel-sp-xs);
      }
    </style>
  </template>
}
