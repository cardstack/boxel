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
// for interactive use for the first time. An operation approved for pipelines
// only is in the batch only for that second choice. The choice starts on
// interactive use when the batch is already approved for it, or holds nothing
// else.
//
// Under that second choice, for a batch a workspace's share fills, the user
// can also let people who aren't signed in use the share. Ticking it adds its
// confirmation to the batch's, says in each group that anyone can use the key
// there, and asks for the anonymous cap of a share allowed it for the first
// time: the calls a day everyone who isn't signed in makes with it, together.
// A personal key is never offered for it. An operation approved for
// signed-in people only is in the batch only while it is ticked.
//
// Opened from a key's "Use with a card" (`#key=<id>&then=keys`), that key
// starts chosen, and the page goes back to the key page when done.
//
// Opened by `boxel keys approve` (`#cli_port=…&cli_state=…`), for an approval
// that grants a key a destination it has none for, the operations the CLI
// listed (`#operations=<name>,…`) start ticked and the others unticked, the
// choice starts on interactive use for `--interactive` (`#interactive=1`),
// anonymous use starts ticked for `--anonymous` (`#anonymous=1`), and
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
  ANONYMOUS_CONFIRMATION,
  approvalOf,
  batchFor,
  confirmationsFor,
  firstAnonymousShares,
  firstInteractiveShares,
  initialAnonymous,
  initialChoice,
  initialUse,
  INTERACTIVE_CONFIRMATION,
  newGrants,
  offersAnonymous,
  operationKey,
  parseAnonymousCap,
  parseDailyBudget,
  placementPhrase,
  remainingFor,
  requestChanges,
  requestFields,
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
      anonymous: boolean;
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
            on its schedule and whenever it’s opened, by anyone, without asking
            you again.
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
              This card calls another service with your key. You approve these
              calls once,
              {{#if this.forOneCard}}
                for this card.
              {{else}}
                and the approval covers every card of this kind in the
                workspace.
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
              as |value|
            >
              {{#if (eq value 'interactive')}}
                {{#if this.offersAnonymous}}
                  <label class='anonymous-use' data-test-approve-anonymous>
                    <Checkbox
                      @checked={{this.form.anonymous}}
                      @disabled={{if this.interactive false true}}
                      @onChange={{this.toggleAnonymous}}
                      data-test-approve-anonymous-tick
                    />
                    <span class='anonymous-text'>
                      <span class='anonymous-label'>Also for people who aren’t
                        signed in</span>
                      <span class='anonymous-hint'>Anyone who opens the card can
                        make these calls with the workspace’s shared key, where
                        the workspace lets them use the card. Your own keys are
                        never used for them.</span>
                    </span>
                  </label>
                {{/if}}
              {{/if}}
            </RadioChoices>
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
                {{#if (this.anonymousAt group)}}
                  <p class='note' data-test-approve-anonymous-note>
                    Anyone can use it for requests to
                    {{group.destination.registrableDomain}}
                    ({{group.destination.host}}{{group.destination.path}}),
                    <strong>including people who aren’t signed in</strong>.
                  </p>
                {{/if}}
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
                        {{else if (eq operation.status 'signed-in-only')}}
                          <span
                            class='pipelines-only'
                            data-test-approve-signed-in-only
                          >Approved for signed-in people</span>
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
                  @tag='label'
                  @label='Daily budget for {{share.label}}'
                  @icon={{KeyRound}}
                  data-test-approve-budget={{share.label}}
                >
                  <BoxelInput
                    @type='text'
                    @autocomplete='off'
                    @value={{this.budgetText share}}
                    @onInput={{fn this.setBudget share.id}}
                    @state={{if (this.budgetValid share) 'none' 'invalid'}}
                    @errorMessage={{unless
                      (this.budgetValid share)
                      'A whole number of calls, at least one'
                    }}
                    inputmode='numeric'
                    data-test-approve-budget-input
                  />
                  <span class='note budget-note'>The most calls this share makes
                    in a day, in total across everyone who opens a card that
                    uses it. This is the first time opened cards can use this
                    share, so set it to what your plan with the service allows.</span>
                </FieldContainer>
              {{/each}}
              {{#each this.capShares as |share|}}
                <FieldContainer
                  @tag='label'
                  @label='Anonymous cap for {{share.label}}'
                  @icon={{KeyRound}}
                  data-test-approve-cap={{share.label}}
                >
                  <BoxelInput
                    @type='text'
                    @autocomplete='off'
                    @value={{this.capText share}}
                    @onInput={{fn this.setCap share.id}}
                    @state={{if (this.capShown share) 'none' 'invalid'}}
                    @errorMessage={{if
                      (not (this.capShown share))
                      (this.capError share)
                    }}
                    inputmode='numeric'
                    data-test-approve-cap-input
                  />
                  <span class='note budget-note'>The most calls this share makes
                    in a day, in total across everyone who isn’t signed in.
                    These calls count toward the share’s daily budget too, so
                    the rest of that budget stays for people who are signed in.</span>
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
      .anonymous-use {
        display: flex;
        align-items: flex-start;
        gap: var(--boxel-sp-xs);
        margin-left: calc(0.8125rem + var(--boxel-sp-xs));
        cursor: pointer;
      }
      .anonymous-text {
        display: grid;
        min-width: 0;
      }
      .anonymous-label {
        font-size: var(--boxel-font-size-sm);
        line-height: var(--boxel-line-height-sm);
      }
      .anonymous-hint {
        font-size: var(--boxel-font-size-xs);
        line-height: var(--boxel-line-height-xs);
        color: var(--muted-foreground);
      }
      .budget-note {
        display: block;
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
    // Whether people who aren't signed in may use the shares it fills, while
    // the use is interactive.
    anonymous: false,
    // A share's daily budget as typed, by share id.
    budgets: {} as Record<string, string>,
    // A share's anonymous cap as typed, by share id.
    caps: {} as Record<string, string>,
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

  // The batch as shown for the choice of where requests run, and by whom.
  private get batch(): ApprovalBatch | undefined {
    return this.choosing
      ? batchFor(this.choosing.batch, this.form.use, this.form.anonymous)
      : undefined;
  }

  private get interactive() {
    return this.form.use === 'interactive';
  }

  // Whether the batch has anything a share fills, which is all anonymous use
  // can be offered for.
  private get offersAnonymous() {
    return this.choosing
      ? offersAnonymous(
          batchFor(this.choosing.batch, 'interactive', true).groups.flatMap(
            (g) => g.operations,
          ),
        )
      : false;
  }

  // Whether this approval lets people who aren't signed in use the shares it
  // fills.
  private get anonymous() {
    return (
      this.interactive &&
      this.form.anonymous &&
      offersAnonymous(this.tickedOperations)
    );
  }

  private toggleAnonymous = () => {
    this.form.anonymous = !this.form.anonymous;
    this.form.error = undefined;
  };

  // A group says anyone can use the key there when a ticked operation in it
  // sends a share's key for people who aren't signed in.
  private anonymousAt = (group: { operations: BatchOperation[] }) =>
    this.anonymous &&
    offersAnonymous(
      group.operations.filter((o) => this.form.ticked.has(operationKey(o))),
    );

  // Whether what is shown is approved for one card (an operation approved
  // per instance) rather than for every card of its kind.
  private get forOneCard() {
    return (this.batch?.groups ?? []).some((g) =>
      g.operations.some((o) => o.instance !== null),
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
    return [
      ...confirmationsFor(this.tickedOperations).map(
        (kind) => INTERACTIVE_CONFIRMATION[kind],
      ),
      ...(this.anonymous ? [ANONYMOUS_CONFIRMATION] : []),
    ];
  }

  // The shares this approval allows for people who aren't signed in for the
  // first time, each with the daily budget it will have.
  private get capShares() {
    return this.batch && this.anonymous
      ? firstAnonymousShares(
          this.batch,
          this.tickedOperations,
          this.form.chosen,
        ).map((share) => ({
          ...share,
          dailyBudget: this.budgetShares.some((b) => b.id === share.id)
            ? (parseDailyBudget(this.budgetText(share)) ?? share.dailyBudget)
            : share.dailyBudget,
        }))
      : [];
  }

  private capText = (share: { id: string }) => this.form.caps[share.id] ?? '';

  private capValid = (share: { id: string; dailyBudget: number }) =>
    parseAnonymousCap(this.capText(share), share.dailyBudget) !== undefined;

  // An empty cap is waiting to be typed, not wrong yet.
  private capShown = (share: { id: string; dailyBudget: number }) =>
    this.capText(share).trim() === '' || this.capValid(share);

  private capError = (share: { dailyBudget: number }) =>
    `A whole number of calls, from 1 to the daily budget of ${share.dailyBudget}`;

  private setCap = (shareId: string, value: string) => {
    this.form.caps = { ...this.form.caps, [shareId]: value };
    this.form.error = undefined;
  };

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
      this.budgetShares.some((share) => !this.budgetValid(share)) ||
      this.capShares.some((share) => !this.capValid(share))
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
          anonymous: true,
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
          anonymous: false,
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
              : initialChoice(batch, c, this.opened.key),
          ];
        }),
      );
      if (!keep) {
        this.form.use = initialUse(batch, {
          cliInteractive: this.fromCli.interactive,
        });
        this.form.anonymous = initialAnonymous(batch, {
          cliAnonymous: this.fromCli.anonymous,
        });
      }
      let keys = operations.map(operationKey);
      let named = this.fromCli.operations;
      this.form.ticked = keep
        ? new Set(keys.filter((k) => keep.ticked.has(k)))
        : named
          ? new Set(
              operations.filter((o) => named.has(o.name)).map(operationKey),
            )
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
    await this.args.api.saving(() => this.approve(state));
  };

  private approve = async (state: ChoosingState) => {
    try {
      let interactive = this.interactive;
      let anonymous = this.anonymous;
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
      let anonymousCaps = Object.fromEntries(
        this.capShares.map((share) => [
          share.id,
          parseAnonymousCap(this.capText(share), share.dailyBudget)!,
        ]),
      );
      await approveOperations(this.args.api.config, {
        realm: state.batch.realm.url,
        operations,
        interactive,
        anonymous,
        dailyBudgets,
        anonymousCaps,
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
