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
// The user chooses, once for the batch, where the approved requests may run:
// only in the card's scheduled pipelines (where the choice starts), or also
// when a card is opened, in the browser, the AI assistant or the CLI.
// Choosing the second shows what it allows, once, for the user's own keys and
// for a workspace's share, and asks for the daily budget of a share approved
// for interactive use for the first time, linking to the share's
// `share-limits` page, in a new tab, for its other limits: each person's rate
// and the share's monthly budget. That page changes the daily budget too, so
// coming back to this window re-reads the budget in force for a field the
// user hasn't typed in. An operation approved for pipelines
// only is in the batch only for that second choice. The choice starts on
// interactive use when the batch is already approved for it, or holds nothing
// else. An operation last approved for interactive use is marked, and
// approving it for pipelines only says that it then stops running when a card
// is opened.
//
// Who may make the calls is not chosen here. Where the realm's policy opens an
// operation to people who aren't signed in (`openToAnonymous`), interactive
// use of a share whose key allows them serves them too: each group it sends
// to says "including people who aren't signed in", and the confirmation adds
// a line for it, with the key's anonymous cap. A share whose key doesn't allow
// them is said to serve signed-in people only. The anonymous cap is the
// key's, counted across every realm it is shared into, and the share's daily
// budget bounds their calls here too.
//
// Opened from a key's "Use with a card" (`#key=<id>&then=keys`), that key
// starts chosen, and the page goes back to the key page when done. Opened for
// one of the user's shares (`#share=<id>&then=keys`), that share starts
// chosen for each slot the realm's key fills, and only the operations that
// send the realm's key start ticked.
//
// Opened by `boxel keys approve` (`#cli_port=…&cli_state=…`), for an approval
// that grants a key a destination it has none for, the operations the CLI
// listed (`#operations=<name>,…`) start ticked and the others unticked, the
// choice starts on interactive use for `--interactive` (`#interactive=1`), and
// the page tells the CLI's listener when the approval is made, or that it was
// cancelled when the user cancels or closes the window first (`KeysWindow`).
// It hands over nothing but that: the CLI reads the approval from the realm
// server.
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import type Owner from '@ember/owner';
import Component from '@glimmer/component';
import { trackedObject } from '@ember/reactive/collections';

import {
  approvalBatch,
  approveOperations,
  shareUsage,
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
import Globe from '../../components/icons/globe.gts';
import BoxelInput from '../../components/input.gts';
import KeyRound from '../../components/icons/key-round.gts';
import RadioTile from '../../components/radio-tile.gts';
import { eq, gt } from '../../helpers/truth-helpers.ts';
import { navigation } from '../navigation.js';
import { pageURL } from '../urls.js';

import {
  anonymousConfirmation,
  approvalOf,
  approvalScope,
  approvedForOpenCards,
  batchFor,
  confirmationsFor,
  firstInteractiveShares,
  initialChoice,
  initialUse,
  INTERACTIVE_CONFIRMATION,
  newGrants,
  operationKey,
  parseDailyBudget,
  placementPhrase,
  remainingFor,
  requestChanges,
  requestFields,
  sharesForVisitors,
  slotChoices,
  type ApprovalUse,
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
import RadioChoices, { type RadioChoice } from './radio-choices.gts';
import { cliOpenedFor, contextRequest, openedFor } from './opened-for.ts';

type State =
  | { name: 'loading' }
  | { name: 'load-failed'; failure: LoadFailure }
  | { name: 'choosing'; batch: ApprovalBatch; context: WindowContext }
  | {
      name: 'done';
      count: number;
      card: string;
      realm: string;
      interactive: boolean;
      // Whether the approval serves people who aren't signed in too.
      anonymous?: boolean;
    };
type ChoosingState = Extract<State, { name: 'choosing' }>;

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
          <strong>{{this.done.card}}</strong>
          in
          <strong>{{this.done.realm}}</strong>
          can make
          <strong data-test-approve-done-count>{{this.done.count}}</strong>
          {{if (eq this.done.count 1) 'call' 'calls'}}
          with your key
          {{#if this.done.anonymous}}
            on its schedule and whenever anyone opens it,
            <strong data-test-approve-done-anonymous>including people who aren’t
              signed in</strong>, without asking you again.
          {{else if this.done.interactive}}
            on its schedule and whenever it’s opened, without asking you again.
          {{else}}
            on its schedule, without asking you again.
          {{/if}}
        {{/if}}
      </DonePage>
    {{else if this.choosing}}
      <form novalidate {{on 'submit' this.save}} data-test-approve-form>
        <EditPage @heading={{this.heading}} data-test-approve>
          <:intro>
            {{#if @review}}
              This card changed these calls since you approved them. Boxel won’t
              make them until you approve them again.
            {{else}}
              This card calls another service with your key.
              {{#if (eq this.scope 'card')}}
                You approve these calls once, for this card.
              {{else if (eq this.scope 'mixed')}}
                You approve these calls once. Some cover only this card, and the
                rest cover every card of this kind in the workspace.
              {{else}}
                You approve these calls once, and the approval covers every card
                of this kind in the workspace.
              {{/if}}
              After that, Boxel makes them exactly as shown below without asking
              you again. If the card changes a call, Boxel asks you to approve
              it again before making it.
            {{/if}}
          </:intro>
          <:default>
            {{#if this.summaryContext}}
              <OpenedForSummary
                @context={{this.summaryContext}}
                @reason={{this.opened.reason}}
              />
            {{/if}}
            <RadioChoices
              @label='When calls run'
              @icon={{Globe}}
              @name='approve-use'
              @choices={{this.useChoices}}
              @selected={{this.form.use}}
              @onSelect={{this.chooseUse}}
            />
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
                    <RadioTile
                      @name='slot-{{choice.slot}}'
                      @value={{option.id}}
                      @checked={{this.isChosen choice.slot option.id}}
                      @onChange={{fn this.choose choice.slot option.id}}
                      data-test-approve-key={{option.name}}
                    >
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
                    </RadioTile>
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

            {{#each this.batch.groups as |group|}}
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
                  <p class='note' data-test-approve-whole-host>Boxel can send
                    the key with any call to this host.</p>
                {{/if}}
                {{#let (this.visitorsAt group) as |visitors|}}
                  {{#if visitors.anyone.length}}
                    <p class='note' data-test-approve-anonymous-note>
                      Anyone can use it for requests to
                      {{group.destination.registrableDomain}}
                      ({{group.destination.host}}{{group.destination.path}}),
                      <strong>including people who aren’t signed in</strong>.
                    </p>
                  {{/if}}
                  {{#each visitors.signedInOnly as |share|}}
                    <p class='note' data-test-approve-signed-in-only-note>
                      This workspace lets people who aren’t signed in make these
                      calls, but the key shared as
                      <strong>{{share.label}}</strong>
                      allows signed-in people only, so they’re asked to sign in.
                    </p>
                  {{/each}}
                {{/let}}
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
                        {{else if (eq operation.status 'pipelines-only')}}
                          <span
                            class='pipelines-only'
                            data-test-approve-pipelines-only
                          >Approved for the schedule</span>
                        {{/if}}
                        {{#if (approvedForOpenCards operation)}}
                          <span
                            class='pipelines-only'
                            data-test-approve-open-cards
                          >Approved for open cards</span>
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

            {{#if this.remaining}}
              <p class='more' data-test-approve-remaining>
                This card has
                {{this.remaining}}
                more
                {{if (eq this.remaining 1) 'call' 'calls'}}
                to approve. Approve these, then open this window from the card
                again to see the rest.
              </p>
            {{/if}}
            {{#if this.demoted}}
              <p class='more' data-test-approve-demoted>
                Approving with “On a schedule only” stops the calls marked
                “Approved for open cards” from running when the card is opened.
              </p>
            {{/if}}
            {{#if this.interactive}}
              <div class='interactive' data-test-approve-interactive>
                <Warning class='new-grant-icon' aria-hidden='true' />
                <div class='interactive-text'>
                  {{#each this.confirmations as |line|}}
                    <p data-test-approve-confirmation>{{line}}</p>
                  {{/each}}
                </div>
              </div>
              {{#each this.budgetShares as |share|}}
                <FieldContainer
                  @tag='div'
                  @label='Daily budget for {{share.label}}'
                  @icon={{KeyRound}}
                  data-test-approve-budget={{share.label}}
                  as |labelId|
                >
                  <BoxelInput
                    @type='text'
                    @autocomplete='off'
                    @value={{this.budgetText share}}
                    @onInput={{fn this.setBudget share.id}}
                    @state={{if (this.budgetValid share) 'none' 'invalid'}}
                    @errorMessage={{this.budgetError share}}
                    @describedBy='budget-note-{{share.id}}'
                    inputmode='numeric'
                    aria-labelledby={{labelId}}
                    data-test-approve-budget-input
                  />
                  <span
                    id='budget-note-{{share.id}}'
                    class='note budget-note'
                  >The most calls this share makes in a day, in total across
                    everyone who opens a card that uses it. This is the first
                    time opened cards can use this share, so set it to what your
                    plan with the service allows.</span>
                  <span
                    class='note budget-note budget-more'
                    data-test-approve-budget-more
                  >
                    <a
                      class='limits-link'
                      href={{this.shareLimitsURL share}}
                      target='_blank'
                      rel='noopener noreferrer'
                      data-test-approve-budget-limits-link
                    >Open the limits for {{share.label}} in a new tab</a>
                    to change its other limits: how fast each person can make
                    calls, and how many calls this share makes in a month, in
                    total across everyone.</span>
                </FieldContainer>
              {{/each}}
            {{/if}}
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
                  Approving lets Boxel make the calls above, and send
                  {{#each this.newGrantNotes as |note index|}}{{#if index}}
                      and
                    {{/if}}<strong>{{note.keyName}}</strong>
                    to
                    {{note.hosts}}{{/each}}
                  for the first time.
                </p>
              {{/if}}
              <div class='confirm-buttons'>
                {{#if @api.forCli}}
                  <Button
                    @kind='secondary'
                    @disabled={{this.form.saving}}
                    data-test-keys-cancel
                    {{on 'click' @api.close}}
                  >Cancel</Button>
                {{/if}}
                <Button
                  type='submit'
                  @kind='primary'
                  @disabled={{this.submitDisabled}}
                  @loading={{this.form.saving}}
                  data-test-approve-save
                >{{this.saveLabel}}</Button>
              </div>
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
      .option {
        display: flex;
        flex-direction: column;
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
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
      .budget-note {
        display: block;
      }
      .budget-more {
        margin-top: var(--boxel-sp-xxs);
      }
      .limits-link {
        display: inline;
        text-decoration: underline;
      }
      .limits-link:hover {
        color: var(--foreground);
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
        flex: 1;
        min-width: 0;
        font-weight: 600;
      }
      /* A badge keeps its words on one line; the label beside it wraps. */
      .changed,
      .pipelines-only {
        flex-shrink: 0;
        white-space: nowrap;
      }
      .changed {
        padding: 0 var(--boxel-sp-4xs);
        border-radius: var(--boxel-border-radius-xs);
        background-color: var(--warning);
        color: var(--warning-foreground);
        font-size: var(--boxel-font-size-xs);
        font-weight: 600;
      }
      .pipelines-only {
        padding: 0 var(--boxel-sp-4xs);
        border-radius: var(--boxel-border-radius-xs);
        background-color: var(--muted);
        color: var(--muted-foreground);
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
      .confirm-buttons {
        display: flex;
        gap: var(--boxel-sp-xs);
        flex-shrink: 0;
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
      .more {
        margin: 0;
        font-size: var(--boxel-font-size-sm);
        line-height: var(--boxel-line-height-sm);
        color: var(--muted-foreground);
      }
      .interactive {
        display: flex;
        gap: var(--boxel-sp-xs);
        align-items: flex-start;
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        border-radius: var(--boxel-border-radius);
        background-color: var(--muted);
        font-size: var(--boxel-font-size-sm);
        line-height: var(--boxel-line-height-sm);
        overflow-wrap: anywhere;
      }
      .interactive-text p {
        margin: 0;
      }
      .interactive-text p + p {
        margin-top: var(--boxel-sp-xs);
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
  private fromCli = cliOpenedFor();
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
    use: 'pipelines' as ApprovalUse,
    // A share's daily budget as typed, by share id.
    budgets: {} as Record<string, string>,
    saving: false,
    error: undefined as string | undefined,
  });

  private useChoices: RadioChoice[] = [
    {
      value: 'pipelines',
      label: 'On a schedule only',
      hint: 'The card’s scheduled pipelines make these calls and save the results to the card. Opening the card makes no calls.',
    },
    {
      value: 'interactive',
      label: 'On a schedule and when the card is opened',
      hint: 'The card’s pipelines make these calls, and so does the card itself whenever it’s opened: in your browser, from the AI assistant, or from the CLI.',
    },
  ];

  constructor(owner: Owner, args: ApproveArgs) {
    super(owner, args);
    this.load();
    document.addEventListener('visibilitychange', this.refreshBudgets);
    window.addEventListener('focus', this.refreshBudgets);
  }

  willDestroy() {
    super.willDestroy();
    document.removeEventListener('visibilitychange', this.refreshBudgets);
    window.removeEventListener('focus', this.refreshBudgets);
  }

  private get heading() {
    return this.args.review ? 'Review changed calls' : 'Approve calls';
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

  // The batch as shown for the choice of where requests run.
  private get batch(): ApprovalBatch | undefined {
    return this.choosing
      ? batchFor(this.choosing.batch, this.form.use)
      : undefined;
  }

  private get interactive() {
    return this.form.use === 'interactive';
  }

  private get scope() {
    return approvalScope(this.batch);
  }

  // Whether approving for pipelines only takes ticked calls last approved for
  // interactive use back to the schedule.
  private get demoted() {
    return (
      !this.interactive && this.tickedOperations.some(approvedForOpenCards)
    );
  }

  private get remaining() {
    return this.choosing ? remainingFor(this.choosing.batch, this.form.use) : 0;
  }

  private get choices(): SlotChoice[] {
    return this.batch ? slotChoices(this.batch) : [];
  }

  private get newGrants(): NewGrant[] {
    return this.batch
      ? newGrants(this.batch, this.choices, this.form.chosen, this.form.ticked)
      : [];
  }

  private get confirmations(): string[] {
    let anyone = this.visitors.anyone;
    return [
      ...confirmationsFor(this.tickedOperations).map(
        (kind) => INTERACTIVE_CONFIRMATION[kind],
      ),
      ...(anyone.length > 0 ? [anonymousConfirmation(anyone)] : []),
    ];
  }

  // Who besides signed-in people the ticked operations serve once approved
  // for opened cards: the realm's policy and each share's owner decide that,
  // and the page only says so.
  private get visitors() {
    return this.batch && this.interactive
      ? sharesForVisitors(this.batch, this.tickedOperations, this.form.chosen)
      : { anyone: [], signedInOnly: [] };
  }

  private visitorsAt = (group: { operations: BatchOperation[] }) =>
    this.batch && this.interactive
      ? sharesForVisitors(
          this.batch,
          group.operations.filter((o) => this.form.ticked.has(operationKey(o))),
          this.form.chosen,
        )
      : { anyone: [], signedInOnly: [] };

  // The shares this approval allows in open cards for the first time.
  private get budgetShares() {
    return this.batch && this.interactive
      ? firstInteractiveShares(
          this.batch,
          this.tickedOperations,
          this.form.chosen,
        )
      : [];
  }

  private budgetText = (share: { id: string; dailyBudget: number }) =>
    this.form.budgets[share.id] ?? String(share.dailyBudget);

  private budgetValid = (share: { id: string; dailyBudget: number }) =>
    parseDailyBudget(this.budgetText(share)) !== undefined;

  private budgetError = (share: { id: string; dailyBudget: number }) =>
    this.budgetValid(share)
      ? undefined
      : 'A whole number of calls, at least one';

  // A share's usage and limits page, where its owner changes the limits this
  // page doesn't ask for. It opens in a tab of its own, so the batch being
  // approved here stays as it is.
  private shareLimitsURL = (share: { id: string }) => {
    let realm = this.choosing?.batch.realm.url;
    return realm
      ? `${pageURL('share-limits')}#${new URLSearchParams({ realm, share: share.id })}`
      : undefined;
  };

  // The share-limits page this page links to changes a share's daily budget
  // too, and approving writes the budget the field holds. So when the window
  // comes back into view, each budget field the user hasn't typed in takes the
  // budget in force, and approving never puts back one changed meanwhile. A
  // budget the user typed is what they see, and stays. Approving waits for a
  // re-read under way: coming back to the window by clicking Approve starts
  // one on that same click.
  private budgetRefresh: Promise<void> | undefined;

  private refreshBudgets = () => {
    let refresh = this.readBudgetsInForce();
    this.budgetRefresh = refresh;
    return refresh;
  };

  private readBudgetsInForce = async () => {
    let state = this.choosing;
    if (document.visibilityState !== 'visible' || !state || this.form.saving) {
      return;
    }
    let untyped = this.budgetShares.filter(
      (share) => this.form.budgets[share.id] === undefined,
    );
    let { config } = this.args.api;
    let inForce = new Map<string, number>();
    await Promise.all(
      untyped.map(async (share) => {
        try {
          let { limits } = await shareUsage(config, share.id);
          inForce.set(share.id, limits.dailyBudget);
        } catch {
          // The field keeps the budget it has; a session that ended is the
          // window's to notice.
        }
      }),
    );
    if (inForce.size === 0 || this.page.state !== state) {
      return;
    }
    this.page.state = {
      ...state,
      batch: {
        ...state.batch,
        shares: state.batch.shares.map((share) =>
          inForce.has(share.id)
            ? { ...share, dailyBudget: inForce.get(share.id)! }
            : share,
        ),
      },
    };
  };

  private setBudget = (shareId: string, value: string) => {
    this.form.budgets = { ...this.form.budgets, [shareId]: value };
    this.form.error = undefined;
  };

  private chooseUse = (value: string) => {
    this.form.use = value as ApprovalUse;
    this.form.error = undefined;
  };

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
    return (this.batch?.groups ?? []).flatMap((g) =>
      g.operations.filter((o) => this.form.ticked.has(operationKey(o))),
    );
  }

  private get saveLabel() {
    let count = this.tickedOperations.length;
    return `Approve ${count} ${count === 1 ? 'call' : 'calls'}`;
  }

  private get submitDisabled() {
    let ticked = this.tickedOperations;
    return (
      this.form.saving ||
      ticked.length === 0 ||
      ticked.some((o) => o.slots.some((s) => !this.form.chosen[s.slot])) ||
      this.budgetShares.some((share) => !this.budgetValid(share))
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
          'This link doesn’t name a card whose calls to approve.',
        );
      }
      let [context, batch] = await Promise.all([
        windowContext(config, request),
        approvalBatch(config, {
          target: this.opened.target,
          review: this.args.review,
          interactive: true,
        }),
      ]);
      let operations = batch.groups.flatMap((g) => g.operations);
      if (operations.length === 0) {
        this.page.state = {
          name: 'done',
          count: 0,
          card: batch.card.name,
          realm: batch.realm.name,
          interactive: false,
        };
        this.args.api.visit.loaded();
        this.args.api.tellCliDone();
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
              : initialChoice(
                  batch,
                  c,
                  c.kind === 'userKey' ? this.opened.key : this.opened.share,
                ),
          ];
        }),
      );
      if (!keep) {
        this.form.use = initialUse(batch, {
          cliInteractive: this.fromCli.interactive,
        });
      }
      let keys = operations.map(operationKey);
      let named = this.fromCli.operations;
      // Opened for a share, only the operations that send the realm's key
      // start ticked: the user came to approve that share, not their own key.
      let forShare = this.opened.share
        ? (o: BatchOperation) => o.slots.every((s) => s.key !== 'userKey')
        : undefined;
      this.form.ticked = keep
        ? new Set(keys.filter((k) => keep.ticked.has(k)))
        : named
          ? new Set(
              operations.filter((o) => named.has(o.name)).map(operationKey),
            )
          : forShare
            ? new Set(operations.filter(forShare).map(operationKey))
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
    if (this.args.api.tellCliDone()) {
      return;
    }
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
    await this.args.api.saving(async () => {
      await this.budgetRefresh;
      await this.approve(this.choosing ?? state);
    });
  };

  private approve = async (state: ChoosingState) => {
    try {
      let interactive = this.interactive;
      let anonymous = this.visitors.anyone.length > 0;
      let operations = approvalOf(
        this.batch!,
        this.choices,
        this.form.chosen,
        this.form.ticked,
      );
      let dailyBudgets = Object.fromEntries(
        this.budgetShares.map((share) => [
          share.id,
          parseDailyBudget(this.budgetText(share))!,
        ]),
      );
      await approveOperations(this.args.api.config, {
        realm: state.batch.realm.url,
        operations,
        interactive,
        dailyBudgets,
      });
      this.page.state = {
        name: 'done',
        count: operations.length,
        card: state.batch.card.name,
        realm: state.batch.realm.name,
        interactive,
        anonymous,
      };
      if (!this.args.api.tellCliDone() && !this.fromKeyPage) {
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
        this.form.error = `${failureMessage(e)} The calls below are as the card makes them now.`;
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
    <KeysWindow
      @title='Boxel · Approve calls'
      @page='approve'
      @cli={{this.cli}}
      as |api|
    >
      <Approve @api={{api}} @review={{false}} />
    </KeysWindow>
  </template>

  private cli = cliOpenedFor().cli;
}

export class ReviewChangesPage extends Component {
  <template>
    <KeysWindow
      @title='Boxel · Review changed calls'
      @page='review-changes'
      @cli={{this.cli}}
      as |api|
    >
      <Approve @api={{api}} @review={{true}} />
    </KeysWindow>
  </template>

  private cli = cliOpenedFor().cli;
}
