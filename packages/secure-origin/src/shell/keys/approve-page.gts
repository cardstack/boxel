// The `approve` and `review-changes` pages: every `callApi` operation on one
// card definition, in one realm, that needs the user's approval, approved in
// one confirmation. The page is opened for the one operation a card is
// blocked on; the realm server gathers the rest (`POST /_key-bindings/batch`),
// so a card never lists its own operations. `review-changes` shows only the
// operations whose request changed since they were approved, each with what
// changed, field by field.
//
// Operations are grouped by where they send: the registrable domain once per
// group in large type, the full host and path beneath it, then one line per
// operation led by its label, with its method, path and where the key goes,
// expanding to the full request. One choice per slot covers the whole batch,
// listing the keys (or, for a slot a realm's share fills, the user's shares
// there) whose grants already cover the batch first. A chosen key with no
// grant where a group sends makes that a new grant: the group says so by its
// full host, and the Approve button, the one confirmation, says which hosts
// each key is sent to for the first time. An operation's label never stands
// in for a host. Unticking an operation leaves it unapproved.
//
// Opened from a key's "Use with a card" (`#key=<id>&then=keys`), that key
// starts chosen, and the page goes back to the key page when done.
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import type Owner from '@ember/owner';
import Component from '@glimmer/component';
import { trackedObject } from '@ember/reactive/collections';

import {
  approvalBatch,
  approveOperations,
  windowContext,
  type ApprovalBatch,
  type BatchOperation,
  type BatchSlot,
} from '../../security/keys.ts';
import BusyMessage from '../../components/busy-message.gts';
import Button from '../../components/button.gts';
import Checkbox from '../../components/checkbox.gts';
import Warning from '../../components/icons/warning.gts';
import FieldContainer from '../../components/field-container.gts';
import KeyRound from '../../components/icons/key-round.gts';
import { eq, gt } from '../../helpers/truth-helpers.ts';
import { navigation } from '../navigation.js';
import { pageURL } from '../urls.js';

import {
  approvalOf,
  initialChoice,
  newGrants,
  operationKey,
  placementPhrase,
  requestChanges,
  requestFields,
  slotChoices,
  type NewGrant,
  type SlotChoice,
} from './approval-batch.ts';
import {
  failureMessage,
  isSignedOut,
  LinkError,
  loadFailure,
  type LoadFailure,
} from './context.ts';
import type { WindowContext } from './context.ts';
import DonePage from './done-page.gts';
import EditPage from './edit-page.gts';
import KeysWindow, { type KeysWindowAPI } from './keys-window.gts';
import LoadFailed from './load-failed.gts';
import OpenedForSummary from './opened-for-summary.gts';
import { contextRequest, openedFor } from './opened-for.ts';

type State =
  | { name: 'loading' }
  | { name: 'load-failed'; failure: LoadFailure }
  | { name: 'choosing'; batch: ApprovalBatch; context: WindowContext }
  | { name: 'done'; count: number; card: string; realm: string };

interface ApproveArgs {
  api: KeysWindowAPI;
  review: boolean;
}

function slotLabel(choice: SlotChoice): string {
  if (choice.kind === 'userKey') {
    return 'Your key';
  }
  let [, name] = choice.slot.split(':');
  return name ? `Shared key: ${name}` : 'Shared key';
}

class Approve extends Component<{ Args: ApproveArgs }> {
  <template>
    {{#if this.loading}}
      <BusyMessage class='busy' @title='Loading…' />
    {{else if this.loadFailed}}
      <LoadFailed
        @heading={{this.heading}}
        @failure={{this.loadFailed.failure}}
        @onRetry={{this.load}}
      />
    {{else if this.done}}
      <DonePage @heading='Approved' @onClose={{this.finish}}>
        {{#if (eq this.done.count 0)}}
          Nothing on
          <strong>{{this.done.card}}</strong>
          in
          <strong>{{this.done.realm}}</strong>
          needs your approval.
        {{else}}
          <strong data-test-approve-done-count>{{this.done.count}}</strong>
          {{if (eq this.done.count 1) 'request' 'requests'}}
          on
          <strong>{{this.done.card}}</strong>
          in
          <strong>{{this.done.realm}}</strong>
          can use your key in scheduled pipelines.
        {{/if}}
      </DonePage>
    {{else if this.choosing}}
      <form novalidate {{on 'submit' this.save}} data-test-approve-form>
        <EditPage @heading={{this.heading}} data-test-approve>
          <:intro>
            {{#if @review}}
              The card changed what it sends in these requests since you
              approved them. Nothing is sent until you approve them again.
            {{else}}
              Approve once for every request this card makes with your key here.
              Each is used only as you see it below: if the card changes one, it
              asks you again.
            {{/if}}
            Approved requests run only in scheduled pipelines.
          </:intro>
          <:default>
            {{#if this.summaryContext}}
              <OpenedForSummary
                @context={{this.summaryContext}}
                @reason={{this.opened.reason}}
              />
            {{/if}}
            {{#each this.choices as |choice|}}
              <FieldContainer
                @tag='div'
                @label={{slotLabel choice}}
                @icon={{KeyRound}}
                data-test-approve-slot={{choice.slot}}
              >
                <fieldset class='picker'>
                  <legend class='visually-hidden'>{{slotLabel choice}}</legend>
                  {{#each choice.options as |option|}}
                    <label class='choice' data-test-approve-key={{option.name}}>
                      <input
                        type='radio'
                        name='slot-{{choice.slot}}'
                        value={{option.id}}
                        checked={{this.isChosen choice.slot option.id}}
                        {{on 'change' (fn this.choose choice.slot option.id)}}
                      />
                      <span class='option'>
                        <span class='option-name'>{{option.name}}</span>
                        {{#if option.rejected}}
                          <span
                            class='option-detail'
                            data-test-approve-key-rejected
                          >The service rejected this key. Replace it on your key
                            page first.</span>
                        {{/if}}
                        {{#if option.detail}}
                          <span class='option-detail'>holds
                            {{option.detail}}</span>
                        {{/if}}
                        {{#if (gt option.covers.length 0)}}
                          <span
                            class='option-detail'
                            data-test-approve-key-covers
                          >Already allowed for
                            {{this.hostsOf option.covers}}</span>
                        {{/if}}
                      </span>
                    </label>
                  {{else}}
                    <p class='empty' data-test-approve-no-keys>
                      {{#if (eq choice.kind 'userKey')}}
                        You have no key to use here yet.
                      {{else}}
                        You have no key shared with this workspace yet.
                      {{/if}}
                    </p>
                  {{/each}}
                  {{#if (eq choice.kind 'userKey')}}
                    <Button
                      class='add-key'
                      type='button'
                      @kind='secondary'
                      @size='small'
                      data-test-approve-add-key
                      {{on 'click' this.addKey}}
                    >Add a new key</Button>
                  {{/if}}
                </fieldset>
              </FieldContainer>
            {{/each}}

            {{#each this.choosing.batch.groups as |group|}}
              <section
                class='group'
                aria-labelledby='group-{{group.destination.href}}'
                data-test-approve-group={{group.destination.host}}
              >
                <h2
                  id='group-{{group.destination.href}}'
                  class='domain'
                  data-test-approve-domain
                >
                  {{group.destination.registrableDomain}}
                </h2>
                <div class='where' data-test-approve-where>
                  {{group.destination.host}}{{group.destination.path}}
                </div>
                {{#if (eq group.destination.path '/')}}
                  <p class='note' data-test-approve-whole-host>Any request to
                    this host can be sent with the key.</p>
                {{/if}}
                {{#each (this.newGrantsAt group.destination.href) as |grant|}}
                  <p
                    class='new-grant'
                    data-test-approve-new-grant={{grant.host}}
                  >
                    <Warning class='new-grant-icon' aria-hidden='true' />
                    <span><strong>{{grant.keyName}}</strong>
                      hasn’t been sent to
                      <strong
                        data-test-approve-new-grant-host
                      >{{grant.host}}</strong>
                      before. Approving lets Boxel send it there, and only
                      there.</span>
                  </p>
                {{/each}}
                <ul class='operations'>
                  {{#each group.operations as |operation|}}
                    <li
                      class='operation'
                      data-test-approve-operation={{operation.name}}
                    >
                      <label class='tick'>
                        <Checkbox
                          @checked={{this.isTicked operation}}
                          @onChange={{fn this.toggle operation}}
                          data-test-approve-tick={{operation.name}}
                        />
                        <span class='label' data-test-approve-label>
                          {{operation.label}}
                        </span>
                        {{#if (eq operation.status 'changed')}}
                          <span
                            class='changed'
                            data-test-approve-changed
                          >Changed</span>
                        {{/if}}
                      </label>
                      <details class='request'>
                        <summary class='summary' data-test-approve-summary>
                          <span class='method'>{{operation.method}}</span>
                          <span class='path'>{{operation.path}}</span>
                          {{#each operation.slots as |slot|}}
                            <span class='placement'>· key
                              {{placementPhrase slot.snapshot}}</span>
                          {{/each}}
                        </summary>
                        {{#each operation.slots as |slot|}}
                          {{#if (this.showsDiff slot)}}
                            <table class='diff' data-test-approve-diff>
                              <thead>
                                <tr><th>Changed</th><th>Approved</th><th
                                  >Now</th></tr>
                              </thead>
                              <tbody>
                                {{#each (requestChanges slot) as |change|}}
                                  <tr
                                    data-test-approve-diff-field={{change.field}}
                                  >
                                    <th scope='row'>{{change.field}}</th>
                                    <td><pre>{{change.before}}</pre></td>
                                    <td><pre>{{change.after}}</pre></td>
                                  </tr>
                                {{/each}}
                              </tbody>
                            </table>
                          {{else}}
                            <dl class='full' data-test-approve-request>
                              {{#each (requestFields slot.snapshot) as |row|}}
                                <dt>{{row.field}}</dt>
                                <dd><pre>{{row.value}}</pre></dd>
                              {{/each}}
                            </dl>
                          {{/if}}
                        {{/each}}
                      </details>
                    </li>
                  {{/each}}
                </ul>
              </section>
            {{/each}}

            {{#if this.form.error}}
              <div class='keys-error' role='alert' data-test-keys-error>
                {{this.form.error}}
              </div>
            {{/if}}
          </:default>
          <:actions>
            <div class='confirm'>
              {{#if this.newGrants.length}}
                <p class='confirm-note' data-test-approve-also-sends>
                  This approves the requests shown above, including sending
                  {{#each this.newGrantNotes as |note index|}}{{#if index}}
                      and
                    {{/if}}<strong>{{note.keyName}}</strong>
                    to
                    {{note.hosts}}{{/each}}
                  for the first time.
                </p>
              {{/if}}
              <Button
                type='submit'
                @kind='primary'
                @disabled={{this.submitDisabled}}
                @loading={{this.form.saving}}
                data-test-approve-save
              >{{this.saveLabel}}</Button>
            </div>
          </:actions>
        </EditPage>
      </form>
    {{/if}}

    <style scoped>
      form {
        display: flex;
        flex-direction: column;
        flex: 1;
      }
      .busy {
        margin-top: var(--boxel-sp-xl);
      }
      .picker {
        margin: 0;
        padding: 0;
        border: 0;
        display: grid;
        gap: var(--boxel-sp-xs);
        min-width: 0;
      }
      .visually-hidden {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
      }
      .choice {
        position: relative;
        display: flex;
        gap: var(--boxel-sp-xs);
        align-items: baseline;
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        border-radius: var(--boxel-border-radius);
        box-shadow: 0 0 0 1px var(--border);
        cursor: pointer;
      }
      .choice input {
        position: absolute;
        opacity: 0;
        width: 1px;
        height: 1px;
        margin: 0;
      }
      .choice:has(input:focus-visible) {
        outline: 2px solid var(--ring, var(--boxel-highlight));
        outline-offset: 2px;
      }
      .choice:has(input:checked) {
        box-shadow: 0 0 0 2px var(--primary, var(--boxel-highlight));
      }
      .option {
        display: flex;
        flex-direction: column;
        min-width: 0;
        overflow-wrap: anywhere;
      }
      .option-name {
        font-weight: 600;
      }
      .option-detail,
      .empty,
      .note {
        margin: 0;
        font-size: var(--boxel-font-size-xs);
        line-height: var(--boxel-line-height-xs);
        color: var(--muted-foreground);
      }
      .add-key {
        width: fit-content;
      }
      .group {
        padding: var(--boxel-sp-sm) var(--boxel-sp);
        border-radius: var(--boxel-border-radius);
        box-shadow: 0 0 0 1px var(--border);
        overflow-wrap: anywhere;
      }
      .domain {
        margin: 0;
        font-size: var(--boxel-font-size-xl);
        line-height: var(--boxel-line-height-xl);
        font-weight: 600;
      }
      .where {
        font-family: var(--boxel-monospace-font-family);
        font-size: var(--boxel-font-size-sm);
        line-height: var(--boxel-line-height-sm);
      }
      .operations {
        list-style: none;
        margin: var(--boxel-sp-sm) 0 0;
        padding: 0;
        display: grid;
        gap: var(--boxel-sp-xs);
      }
      .operation {
        border-top: 1px solid var(--border);
        padding-top: var(--boxel-sp-xs);
      }
      .tick {
        display: flex;
        gap: var(--boxel-sp-xs);
        align-items: baseline;
        cursor: pointer;
      }
      .label {
        font-weight: 600;
      }
      .changed {
        padding: 0 var(--boxel-sp-4xs);
        border-radius: var(--boxel-border-radius-xs);
        background-color: var(--warning);
        color: var(--warning-foreground);
        font-size: var(--boxel-font-size-xs);
        font-weight: 600;
      }
      .request {
        margin-inline-start: var(--boxel-sp-lg);
      }
      .summary {
        cursor: pointer;
        font-size: var(--boxel-font-size-sm);
        line-height: var(--boxel-line-height-sm);
        color: var(--muted-foreground);
      }
      .method,
      .path {
        font-family: var(--boxel-monospace-font-family);
        color: var(--foreground);
      }
      pre {
        margin: 0;
        font-family: var(--boxel-monospace-font-family);
        font-size: var(--boxel-font-size-xs);
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }
      .full {
        display: grid;
        grid-template-columns: max-content 1fr;
        gap: var(--boxel-sp-4xs) var(--boxel-sp-xs);
        margin: var(--boxel-sp-xs) 0 0;
        font-size: var(--boxel-font-size-xs);
      }
      .full dt {
        color: var(--muted-foreground);
      }
      .full dd {
        margin: 0;
        min-width: 0;
      }
      .diff {
        width: 100%;
        margin-top: var(--boxel-sp-xs);
        border-collapse: collapse;
        table-layout: fixed;
        font-size: var(--boxel-font-size-xs);
      }
      .diff th,
      .diff td {
        padding: var(--boxel-sp-4xs);
        border: 1px solid var(--border);
        text-align: start;
        vertical-align: top;
      }
      .diff thead th:first-child {
        width: 25%;
      }
      .new-grant {
        display: flex;
        gap: var(--boxel-sp-xs);
        align-items: flex-start;
        margin: var(--boxel-sp-xs) 0 0;
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        border-radius: var(--boxel-border-radius);
        background-color: var(--muted);
        font-size: var(--boxel-font-size-sm);
        line-height: var(--boxel-line-height-sm);
        overflow-wrap: anywhere;
      }
      .new-grant-icon {
        flex-shrink: 0;
        fill: var(--boxel-warning-200);
        width: var(--boxel-icon-xs);
        height: var(--boxel-icon-xs);
        margin-top: var(--boxel-sp-5xs);
      }
      .confirm {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: var(--boxel-sp);
        width: 100%;
        padding-top: var(--boxel-sp);
        border-top: 1px solid var(--border);
      }
      .confirm-note {
        flex: 1;
        margin: 0;
        font-size: var(--boxel-font-size-sm);
        line-height: var(--boxel-line-height-sm);
        color: var(--muted-foreground);
        overflow-wrap: anywhere;
      }
      .confirm-note strong {
        color: var(--foreground);
      }
      .confirm :deep(button) {
        flex-shrink: 0;
      }
      .keys-error {
        color: var(--destructive-ink, var(--boxel-danger));
        font-size: var(--boxel-font-size-xs);
        line-height: var(--boxel-line-height-xs);
        font-weight: 500;
      }
    </style>
  </template>

  private opened = openedFor();
  // Reached from a key's "Use with a card" on the key page.
  private fromKeyPage =
    new URLSearchParams(window.location.hash.replace(/^#/, '')).get('then') ===
    'keys';
  private page = trackedObject<{ state: State }>({
    state: { name: 'loading' },
  });
  private form = trackedObject({
    chosen: {} as Record<string, string | undefined>,
    ticked: new Set<string>(),
    saving: false,
    error: undefined as string | undefined,
  });

  constructor(owner: Owner, args: ApproveArgs) {
    super(owner, args);
    this.load();
  }

  private get heading() {
    return this.args.review ? 'Review changed requests' : 'Approve requests';
  }
  private get loading() {
    return this.page.state.name === 'loading';
  }
  private get loadFailed() {
    return this.page.state.name === 'load-failed' ? this.page.state : undefined;
  }
  private get choosing() {
    return this.page.state.name === 'choosing' ? this.page.state : undefined;
  }
  private get done() {
    return this.page.state.name === 'done' ? this.page.state : undefined;
  }

  // What the window was opened for, without the one operation's destination:
  // the groups below show where every operation in the batch sends.
  private get summaryContext(): WindowContext | undefined {
    let context = this.choosing?.context;
    if (!context?.operation) {
      return context;
    }
    let { destination: _destination, ...operation } = context.operation;
    return { ...context, operation };
  }

  private get choices(): SlotChoice[] {
    return this.choosing ? slotChoices(this.choosing.batch) : [];
  }

  private get newGrants(): NewGrant[] {
    return this.choosing
      ? newGrants(
          this.choosing.batch,
          this.choices,
          this.form.chosen,
          this.form.ticked,
        )
      : [];
  }

  private newGrantsAt = (destination: string) =>
    this.newGrants.filter((g) => g.destination === destination);

  // What approving also allows, by key: the hosts each chosen key goes to for
  // the first time.
  private get newGrantNotes(): { keyName: string; hosts: string }[] {
    let byKey = new Map<string, string[]>();
    for (let grant of this.newGrants) {
      byKey.set(grant.keyName, [
        ...(byKey.get(grant.keyName) ?? []),
        grant.host,
      ]);
    }
    return [...byKey].map(([keyName, hosts]) => ({
      keyName,
      hosts: hosts.join(', '),
    }));
  }

  private get tickedOperations(): BatchOperation[] {
    return (this.choosing?.batch.groups ?? []).flatMap((g) =>
      g.operations.filter((o) => this.form.ticked.has(operationKey(o))),
    );
  }

  private get saveLabel() {
    let count = this.tickedOperations.length;
    return `Approve ${count} ${count === 1 ? 'request' : 'requests'}`;
  }

  private get submitDisabled() {
    let ticked = this.tickedOperations;
    return (
      this.form.saving ||
      ticked.length === 0 ||
      ticked.some((o) => o.slots.some((s) => !this.form.chosen[s.slot]))
    );
  }

  // A slot whose request matches what was approved again (an edit undone)
  // still needs approving, and shows its request in full.
  private showsDiff = (slot: BatchSlot) =>
    slot.status === 'changed' && requestChanges(slot).length > 0;

  private hostsOf = (destinations: string[]) =>
    destinations.map((d) => new URL(d).host).join(', ');

  private isChosen = (slot: string, id: string) =>
    this.form.chosen[slot] === id;
  private isTicked = (operation: BatchOperation) =>
    this.form.ticked.has(operationKey(operation));

  private choose = (slot: string, id: string) => {
    this.form.chosen = { ...this.form.chosen, [slot]: id };
    this.form.error = undefined;
  };

  private toggle = (operation: BatchOperation) => {
    let ticked = new Set(this.form.ticked);
    let key = operationKey(operation);
    if (ticked.has(key)) {
      ticked.delete(key);
    } else {
      ticked.add(key);
    }
    this.form.ticked = ticked;
  };

  // Read again after a request changed while it was shown, the batch keeps
  // what the user chose for what is still in it: an operation they unticked
  // stays unticked, and a key they chose stays chosen.
  private load = async (keep?: {
    chosen: Record<string, string | undefined>;
    ticked: Set<string>;
  }) => {
    this.page.state = { name: 'loading' };
    let { config } = this.args.api;
    try {
      let request = contextRequest(this.opened);
      if (!this.opened.target || !request) {
        throw new LinkError(
          'this page names no card',
          'This link doesn’t name a card whose requests to approve.',
        );
      }
      let [context, batch] = await Promise.all([
        windowContext(config, request),
        approvalBatch(config, {
          target: this.opened.target,
          review: this.args.review,
        }),
      ]);
      let operations = batch.groups.flatMap((g) => g.operations);
      if (operations.length === 0) {
        this.page.state = {
          name: 'done',
          count: 0,
          card: batch.card.name,
          realm: batch.realm.name,
        };
        this.args.api.visit.loaded();
        return;
      }
      let choices = slotChoices(batch);
      this.form.chosen = Object.fromEntries(
        choices.map((c) => {
          let kept = keep?.chosen[c.slot];
          return [
            c.slot,
            kept && c.options.some((o) => o.id === kept)
              ? kept
              : initialChoice(batch, c, this.opened.key),
          ];
        }),
      );
      let keys = operations.map(operationKey);
      this.form.ticked = keep
        ? new Set(keys.filter((k) => keep.ticked.has(k)))
        : new Set(keys);
      this.page.state = { name: 'choosing', batch, context };
      this.args.api.visit.loaded();
    } catch (e) {
      if (isSignedOut(e)) {
        this.args.api.signedOut();
      } else {
        this.args.api.visit.loadFailed(e);
        this.page.state = { name: 'load-failed', failure: loadFailure(e) };
      }
    }
  };

  // Adding a key is the key entry page's; it comes back here, to the same
  // batch, with the new key chosen.
  private addKey = () => {
    let fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    if (this.fromKeyPage) {
      fragment.set('after', 'keys');
    }
    fragment.set('then', this.args.review ? 'review-changes' : 'approve');
    navigation.assign(`${pageURL('enter-key')}#${fragment}`);
  };

  private finish = () => {
    if (this.fromKeyPage) {
      navigation.back(pageURL('keys'));
    } else {
      this.args.api.close();
    }
  };

  private save = async (event: Event) => {
    event.preventDefault();
    let state = this.choosing;
    if (this.submitDisabled || !state) {
      return;
    }
    this.form.saving = true;
    this.form.error = undefined;
    try {
      let operations = approvalOf(
        state.batch,
        this.choices,
        this.form.chosen,
        this.form.ticked,
      );
      await approveOperations(this.args.api.config, {
        realm: state.batch.realm.url,
        operations,
      });
      this.page.state = {
        name: 'done',
        count: operations.length,
        card: state.batch.card.name,
        realm: state.batch.realm.name,
      };
      if (!this.fromKeyPage) {
        this.args.api.close();
      }
    } catch (e) {
      if (isSignedOut(e)) {
        this.args.api.signedOut();
        return;
      }
      // A request that changed since it was shown is shown again.
      if ((e as { status?: unknown })?.status === 409) {
        await this.load({
          chosen: { ...this.form.chosen },
          ticked: new Set(this.form.ticked),
        });
        this.form.error = `${failureMessage(e)} The requests below are as the card sends them now.`;
        return;
      }
      this.form.error = failureMessage(e);
    } finally {
      this.form.saving = false;
    }
  };
}

export class ApprovePage extends Component {
  <template>
    <KeysWindow @title='Boxel · Approve requests' @page='approve' as |api|>
      <Approve @api={{api}} @review={{false}} />
    </KeysWindow>
  </template>
}

export class ReviewChangesPage extends Component {
  <template>
    <KeysWindow
      @title='Boxel · Review changed requests'
      @page='review-changes'
      as |api|
    >
      <Approve @api={{api}} @review={{true}} />
    </KeysWindow>
  </template>
}
