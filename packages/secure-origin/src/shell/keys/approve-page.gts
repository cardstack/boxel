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
// in for a host. Unticking an operation leaves it unapproved. A slot offers
// the keys that fill it in the ticked operations: while only some are
// ticked, the page asks the realm server for the batch's fillers weighed by
// those (`operations`), and Approve waits for the answer.
//
// A key of the user's own and a key they share with the workspace are never
// drawn alike. Each slot is a tinted section of its own (`KeyAudience`),
// headed by whom its key serves: the user alone (everyone else who uses the
// card chooses their own), or everyone who uses the card in the workspace,
// as "When calls run" and the share's key decide. Each tile carries a person
// icon for the user's own key, a group icon for a share. The intro and the
// done page name the same.
//
// The user chooses, once for the batch, where the approved requests may run:
// in the card's automations and also when a card is opened, in the
// browser, the AI assistant or the CLI (offered first), or only in the
// automations. Interactive use shows what it allows, once, for the user's own
// keys and for a workspace's share, and asks for the daily budget of a share approved
// for interactive use for the first time, linking to the share's
// `share-limits` page, in a new tab, for its other limits: each person's rate
// and the share's monthly budget. That page changes the daily budget too, so
// coming back to this window re-reads the budget in force for a field the
// user hasn't typed in. An operation approved for automations
// only is in the batch only for interactive use. Where the choice starts is
// `initialUse`'s: on interactive use, unless the batch was last approved for
// automations only, or the CLI opened the page without `--interactive`. An
// operation last approved for interactive use is marked, and
// approving it for automations only says that it then stops running when a card
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
  type BatchFillers,
  type BatchOperation,
  type BatchSlot,
} from '../../security/keys.ts';
import BusyMessage from '../../components/busy-message.gts';
import { Button } from '@cardstack/pretui/components/button';
import { Checkbox } from '@cardstack/pretui/components/checkbox';
import { Disclosure } from '@cardstack/pretui/components/disclosure';
import { VisuallyHidden } from '@cardstack/pretui/components/visually-hidden';
import { RadioCard } from '@cardstack/pretui/components/radio-card';
import Warning from '../../components/icons/warning.gts';
import { Field } from '@cardstack/pretui/components/field';
import { Alert } from '@cardstack/pretui/components/alert';
import Globe from '@cardstack/boxel-icons/globe';
import { Input } from '@cardstack/pretui/components/input';
import KeyRound from '@cardstack/boxel-icons/key-round';
import { eq, gt } from '@cardstack/pretui/helpers';
import { navigation } from '../navigation.js';
import { pageURL } from '../urls.js';
import { keyPageURL, pageTitle, withWayBack } from './trail.ts';

import {
  anonymousConfirmation,
  approvalOf,
  approvalScope,
  approvedForOpenCards,
  batchFor,
  chosenShares,
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
  tickedOperationNames,
  withTickedFillers,
  type ApprovalUse,
  type NewGrant,
  type SlotChoice,
  type SlotOption,
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
import KeyAudience from './key-audience.gts';
import KeyMark from './key-mark.gts';
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
      // Whether the approved calls send the user's own key, and the labels of
      // the shares they send (how many, and named as one phrase).
      ownKey: boolean;
      shareCount: number;
      shares: string;
    };
type ChoosingState = Extract<State, { name: 'choosing' }>;

interface ApproveArgs {
  api: KeysWindowAPI;
  review: boolean;
}

// What kind of key a slot's section is for.
function slotLabel(choice: SlotChoice): string {
  if (choice.kind === 'userKey') {
    return 'Your own key';
  }
  let [, name] = choice.slot.split(':');
  return name ? `Shared key: ${name}` : 'Shared key';
}

// "A", "A and B", "A, B and C".
const listPhrase = (items: string[]) =>
  new Intl.ListFormat('en', { type: 'conjunction' }).format(items);

// A slot's keys and shares as tiles to choose between, and the one a tile
// stands for.
const cardsOf = (options: SlotOption[]) =>
  options.map(({ id, name }) => ({ value: id, title: name }));
const optionOf = (options: SlotOption[], id: string) =>
  options.find((option) => option.id === id)!;

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
          with
          {{#if this.done.ownKey}}
            your own key{{#if this.done.shares}} and{{/if}}
          {{/if}}
          {{#if this.done.shares}}
            {{if (gt this.done.shareCount 1) 'the keys' 'the key'}}
            you share as
            <strong data-test-approve-done-shares>{{this.done.shares}}</strong>
          {{/if}}
          {{#if this.done.anonymous}}
            on its schedule and whenever anyone opens it,
            <strong data-test-approve-done-anonymous>including people who aren’t
              signed in</strong>, without asking you again.
          {{else if this.done.interactive}}
            on its schedule and whenever it’s opened, without asking you again.
          {{else}}
            on its schedule, without asking you again.
          {{/if}}
          {{#if this.done.ownKey}}
            <span
              class='done-audience'
              data-test-approve-done-audience='userKey'
            >
              {{#if this.done.interactive}}
                Your own key is sent on the card’s scheduled calls and whenever
                you use the card. Everyone else who uses it chooses a key of
                their own.
              {{else}}
                Only the card’s scheduled calls send your own key. Opening the
                card doesn’t use it.
              {{/if}}
            </span>
          {{/if}}
          {{#if this.done.shares}}
            <span
              class='done-audience'
              data-test-approve-done-audience='apiKey'
            >
              {{#if this.done.interactive}}
                Everyone who uses this card in
                <strong>{{this.done.realm}}</strong>
                makes the calls that send
                {{if (gt this.done.shareCount 1) 'the keys' 'the key'}}
                you share, and they count against
                {{if (gt this.done.shareCount 1) 'each share’s' 'the share’s'}}
                limits.
              {{else}}
                Only the card’s scheduled calls in
                <strong>{{this.done.realm}}</strong>
                send
                {{if (gt this.done.shareCount 1) 'the keys' 'the key'}}
                you share. Opening the card doesn’t use
                {{if (gt this.done.shareCount 1) 'them' 'it'}}.
              {{/if}}
            </span>
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
              {{#if (eq this.keyAudience 'apiKey')}}
                This card calls another service with a key you share with this
                workspace,
                {{this.sharedFor}}.
              {{else if (eq this.keyAudience 'both')}}
                This card calls another service with your own key, for you
                alone, and with a key you share with this workspace,
                {{this.sharedFor}}.
              {{else}}
                This card calls another service with your own key, for you
                alone.
              {{/if}}
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
              <KeyAudience
                @kind={{choice.kind}}
                @use={{this.form.use}}
                @anonymous={{this.servesVisitors choice}}
                @workspace={{this.batch.realm.name}}
                @label={{slotLabel choice}}
                @headingId='approve-slot-{{choice.slot}}'
                data-test-approve-slot={{choice.slot}}
                data-test-approve-slot-kind={{choice.kind}}
              >
                <div class='picker'>
                  {{#if choice.options.length}}
                    <RadioCard
                      @name='slot-{{choice.slot}}'
                      @options={{cardsOf choice.options}}
                      @value={{this.chosenIn choice.slot}}
                      @onValueChange={{fn this.choose choice.slot}}
                      aria-labelledby='approve-slot-{{choice.slot}}-kind approve-slot-{{choice.slot}}'
                    >
                      <:media>
                        <KeyMark @shared={{eq choice.kind 'apiKey'}} />
                      </:media>
                      <:default as |card|>
                        {{#let
                          (optionOf choice.options card.value)
                          as |option|
                        }}
                          <span
                            class='option'
                            data-test-approve-key={{option.name}}
                          >
                            <span class='option-name'>{{option.name}}</span>
                            {{#if option.rejected}}
                              <span
                                class='option-detail'
                                data-test-approve-key-rejected
                              >The service rejected this key. Replace it on your
                                key page first.</span>
                            {{/if}}
                            {{#if option.detail}}
                              <span
                                class='option-detail'
                                data-test-approve-share-key
                              >Shares your key
                                <strong>{{option.detail}}</strong></span>
                            {{/if}}
                            {{#if (gt option.covers.length 0)}}
                              <span
                                class='option-detail'
                                data-test-approve-key-covers
                              >Already allowed for
                                {{this.hostsOf option.covers}}</span>
                            {{/if}}
                          </span>
                        {{/let}}
                      </:default>
                    </RadioCard>
                  {{else}}
                    <p class='empty' data-test-approve-no-keys>
                      {{#if (eq choice.kind 'userKey')}}
                        You have no key to use here yet.
                      {{else if this.hasShares}}
                        None of your keys shared with this workspace can be used
                        here.
                      {{else}}
                        You have no key shared with this workspace yet.
                      {{/if}}
                    </p>
                  {{/if}}
                  {{#if (eq choice.kind 'userKey')}}
                    <Button
                      class='add-key'
                      type='button'
                      @variant='secondary'
                      @size='s'
                      data-test-approve-add-key
                      {{on 'click' this.addKey}}
                    >Add a new key</Button>
                  {{/if}}
                </div>
              </KeyAudience>
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
                      <Checkbox
                        class='tick'
                        @checked={{this.isTicked operation}}
                        @onCheckedChange={{fn this.toggle operation}}
                        data-test-approve-tick={{operation.name}}
                      >
                        <span class='label' data-test-approve-label>
                          {{operation.label}}
                        </span>
                        {{#if (eq operation.status 'changed')}}
                          <span
                            class='changed'
                            data-test-approve-changed
                          >Changed</span>
                        {{else if (eq operation.status 'automations-only')}}
                          <span
                            class='automations-only'
                            data-test-approve-automations-only
                          >Approved for the schedule</span>
                        {{/if}}
                        {{#if (approvedForOpenCards operation)}}
                          <span
                            class='automations-only'
                            data-test-approve-open-cards
                          >Approved for open cards</span>
                        {{/if}}
                      </Checkbox>
                      <Disclosure
                        class='request'
                        data-test-approve-request-toggle
                      >
                        <:trigger><span
                            class='summary'
                            data-test-approve-summary
                          ><span class='method'>{{operation.method}}</span>
                            <span class='path'>{{operation.path}}</span>
                            {{#each operation.slots as |slot|}}
                              <span class='placement'>· key
                                {{placementPhrase slot.snapshot}}</span>
                            {{/each}}</span><VisuallyHidden>
                            for
                            {{operation.label}}</VisuallyHidden></:trigger>
                        <:default>
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
                        </:default>
                      </Disclosure>
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
                <Field
                  @reserveMessage={{false}}
                  @orientation='horizontal'
                  @labelTag='span'
                  @label='Daily budget for {{share.label}}'
                  @icon={{KeyRound}}
                  data-test-approve-budget={{share.label}}
                  as |_controlId _messageId labelId|
                >
                  <Input
                    @type='text'
                    autocomplete='off'
                    @value={{this.budgetText share}}
                    @onInput={{fn this.setBudget share.id}}
                    @invalid={{if (this.budgetValid share) false true}}
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
                </Field>
              {{/each}}
            {{/if}}
            {{#if this.form.error}}
              <Alert @tone='danger' role='alert'>
                <span data-test-keys-error>{{this.form.error}}</span>
              </Alert>
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
                    @variant='secondary'
                    @disabled={{this.form.saving}}
                    data-test-keys-cancel
                    {{on 'click' @api.close}}
                  >Cancel</Button>
                {{/if}}
                <Button
                  type='submit'
                  @variant='primary'
                  @disabled={{this.submitDisabled}}
                  @loading={{this.approveBusy}}
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
        display: grid;
        gap: var(--boxel-sp-xs);
        min-width: 0;
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
      .option-detail strong {
        font-weight: 600;
        color: var(--foreground);
      }
      .done-audience {
        display: block;
        margin-top: var(--boxel-sp-xs);
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
        margin-top: var(--boxel-sp-2xs);
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
        gap: var(--boxel-sp-xs);
        align-items: baseline;
      }
      .label {
        flex: 1;
        min-width: 0;
        font-weight: 600;
      }
      /* A badge keeps its words on one line; the label beside it wraps. */
      .changed,
      .automations-only {
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
      .automations-only {
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
      /* The line wraps rather than being cut short, in the page's own
         weight rather than the bolder one the disclosure sets for its
         trigger. */
      .summary {
        line-height: var(--boxel-line-height-sm);
        font-weight: 400;
        white-space: normal;
        overflow-wrap: anywhere;
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
    // What fills each slot in the ticked operations, when only some are
    // ticked (`withTickedFillers`), and whether that is still being asked.
    weighed: undefined as BatchFillers | undefined,
    weighing: false,
    use: 'interactive' as ApprovalUse,
    // A share's daily budget as typed, by share id.
    budgets: {} as Record<string, string>,
    saving: false,
    error: undefined as string | undefined,
  });

  private useChoices: RadioChoice[] = [
    {
      value: 'interactive',
      label: 'On a schedule and when the card is opened',
      hint: 'The card’s automations make these calls, and so does the card itself whenever it’s opened: in your browser, from the AI assistant, or from the CLI.',
    },
    {
      value: 'automations',
      label: 'On a schedule only',
      hint: 'The card’s automations make these calls and save the results to the card. Opening the card makes no calls.',
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
    return pageTitle(this.args.review ? 'review-changes' : 'approve');
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
      ? batchFor(
          withTickedFillers(this.choosing.batch, this.form.weighed),
          this.form.use,
        )
      : undefined;
  }

  private get interactive() {
    return this.form.use === 'interactive';
  }

  private get scope() {
    return approvalScope(this.batch);
  }

  // Whether approving for automations only takes ticked calls last approved for
  // interactive use back to the schedule.
  private get demoted() {
    return (
      !this.interactive && this.tickedOperations.some(approvedForOpenCards)
    );
  }

  private get remaining() {
    return this.choosing ? remainingFor(this.choosing.batch, this.form.use) : 0;
  }

  // Whether the user has any share in the workspace, whether or not a slot
  // can take it.
  private get hasShares() {
    return (this.batch?.shares.length ?? 0) > 0;
  }

  private get choices(): SlotChoice[] {
    return this.batch ? slotChoices(this.batch, this.form.use) : [];
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
    this.keepOfferedChoices();
  };

  // A key stays chosen for a slot only while the slot offers it. The batch
  // shown for one use holds different operations than for the other, and so
  // can offer different keys; a key no longer offered gives way to the one
  // the slot would start on.
  private keepOfferedChoices() {
    let batch = this.batch;
    if (!batch) {
      return;
    }
    let chosen = { ...this.form.chosen };
    for (let choice of slotChoices(batch, this.form.use)) {
      if (!choice.options.some((o) => o.id === chosen[choice.slot])) {
        chosen[choice.slot] = initialChoice(
          batch,
          choice,
          choice.kind === 'userKey' ? this.opened.key : this.opened.share,
        );
      }
    }
    this.form.chosen = chosen;
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
    return (this.batch?.groups ?? []).flatMap((g) =>
      g.operations.filter((o) => this.form.ticked.has(operationKey(o))),
    );
  }

  private get saveLabel() {
    let count = this.tickedOperations.length;
    return `Approve ${count} ${count === 1 ? 'call' : 'calls'}`;
  }

  // Approve shows its spinner while the approval saves and while the keys the
  // ticked operations offer are still being read, so a press in that moment
  // meets a cue rather than a dead button.
  private get approveBusy() {
    return this.form.saving || this.form.weighing;
  }

  private get submitDisabled() {
    let ticked = this.tickedOperations;
    return (
      this.form.saving ||
      this.form.weighing ||
      ticked.length === 0 ||
      ticked.some((o) => o.slots.some((s) => !this.form.chosen[s.slot])) ||
      this.budgetShares.some((share) => !this.budgetValid(share))
    );
  }

  // A slot whose request matches what was approved again (an edit undone)
  // still needs approving, and shows its request in full.
  private showsDiff = (slot: BatchSlot) =>
    slot.status === 'changed' && requestChanges(slot).length > 0;

  // Whom the batch's keys serve, which the intro says: the user alone (their
  // own key), everyone in the workspace (a key they share there), or both.
  private get keyAudience(): 'userKey' | 'apiKey' | 'both' {
    let kinds = new Set(this.choices.map((c) => c.kind));
    return kinds.size > 1 ? 'both' : kinds.has('apiKey') ? 'apiKey' : 'userKey';
  }

  // Whom a shared key serves, as the intro says it: everyone who uses the
  // card, or, approved for the schedule only, the card's scheduled calls.
  private get sharedFor() {
    return this.interactive
      ? 'for everyone who uses the card there'
      : 'for the card’s scheduled calls there';
  }

  // Whether the share chosen for a slot serves people who aren't signed in
  // too: the realm's policy opens a ticked call to them, and the share's key
  // allows them (`sharesForVisitors`).
  private servesVisitors = (choice: SlotChoice) =>
    choice.kind === 'apiKey' &&
    this.visitors.anyone.some(
      (share) => share.id === this.form.chosen[choice.slot],
    );

  private hostsOf = (destinations: string[]) =>
    destinations.map((d) => new URL(d).host).join(', ');

  // '' rather than undefined when no key is chosen for the slot, so its tiles
  // stay controlled: RadioCard takes an undefined @value as uncontrolled and
  // would keep a pick of its own that the form doesn't hold.
  private chosenIn = (slot: string) => this.form.chosen[slot] ?? '';
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
    this.weigh();
  };

  // Each request is numbered, so only the answer to the latest one counts;
  // reading the batch again leaves every answer asked for before it stale.
  private weighings = 0;

  // What fills each slot in the ticked operations, when only some of the
  // batch's are ticked (`tickedOperationNames`); undefined when the batch's
  // own fillers answer.
  private tickedFillers = async (
    batch: ApprovalBatch,
    ticked: Set<string>,
  ): Promise<BatchFillers | undefined> => {
    let operations = tickedOperationNames(batch, ticked);
    if (!operations || !this.opened.target) {
      return undefined;
    }
    let { fillers } = await approvalBatch(this.args.api.config, {
      target: this.opened.target,
      review: this.args.review,
      interactive: true,
      operations,
    });
    return fillers;
  };

  // Asks what fills each slot in the ticked operations alone, when only some
  // are ticked, and keeps a chosen key while it is still offered. Without an
  // answer the page offers the batch's own fillers, which fit every
  // operation, ticked or not.
  private weigh = async () => {
    let state = this.choosing;
    let attempt = ++this.weighings;
    if (!state || !tickedOperationNames(state.batch, this.form.ticked)) {
      this.form.weighed = undefined;
      this.form.weighing = false;
      this.keepOfferedChoices();
      return;
    }
    this.form.weighing = true;
    let weighed: BatchFillers | undefined;
    try {
      weighed = await this.tickedFillers(state.batch, this.form.ticked);
    } catch (e) {
      if (attempt === this.weighings && isSignedOut(e)) {
        this.args.api.signedOut();
        return;
      }
    }
    if (attempt !== this.weighings) {
      return;
    }
    this.form.weighed = weighed;
    this.form.weighing = false;
    this.keepOfferedChoices();
  };

  // Read again after a request changed while it was shown, the batch keeps
  // what the user chose for what is still in it: an operation they unticked
  // stays unticked, and a key they chose stays chosen.
  private load = async (keep?: {
    chosen: Record<string, string | undefined>;
    ticked: Set<string>;
  }) => {
    this.page.state = { name: 'loading' };
    this.weighings++;
    this.form.weighed = undefined;
    this.form.weighing = false;
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
          ownKey: false,
          shareCount: 0,
          shares: '',
        };
        this.args.api.visit.loaded();
        this.args.api.tellCliDone();
        return;
      }
      if (!keep) {
        this.form.use = initialUse(batch, {
          cli: this.fromCli.cli !== undefined,
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
      // Each slot starts on a key it offers, in the ticked operations, for
      // the use the choice starts on, or keeps the one the user chose while
      // it still does. Without an answer for the ticked operations, it offers
      // the batch's own fillers, which fit every operation.
      let weighed: BatchFillers | undefined;
      try {
        weighed = await this.tickedFillers(batch, this.form.ticked);
      } catch (e) {
        if (isSignedOut(e)) {
          throw e;
        }
      }
      this.form.weighed = weighed;
      let shown = batchFor(withTickedFillers(batch, weighed), this.form.use);
      this.form.chosen = Object.fromEntries(
        slotChoices(shown, this.form.use).map((c) => {
          let kept = keep?.chosen[c.slot];
          return [
            c.slot,
            kept && c.options.some((o) => o.id === kept)
              ? kept
              : initialChoice(
                  shown,
                  c,
                  c.kind === 'userKey' ? this.opened.key : this.opened.share,
                ),
          ];
        }),
      );
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
  // batch, with the new key chosen, or through its trail without one.
  private addKey = () => {
    let fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    if (this.fromKeyPage) {
      fragment.set('after', 'keys');
    }
    fragment.set('then', this.args.review ? 'review-changes' : 'approve');
    navigation.assign(withWayBack(`${pageURL('enter-key')}#${fragment}`));
  };

  private finish = () => {
    if (this.args.api.tellCliDone()) {
      return;
    }
    if (this.fromKeyPage) {
      navigation.back(keyPageURL());
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
      // What the done page says is read before the request, from what is
      // approved, since the form stays live while it is in flight.
      let ownKey = this.tickedOperations.some((o) =>
        o.slots.some((s) => s.key === 'userKey'),
      );
      let shares = chosenShares(
        state.batch,
        this.tickedOperations,
        this.form.chosen,
      ).map((share) => share.label);
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
        ownKey,
        shareCount: shares.length,
        shares: listPhrase(shares),
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
