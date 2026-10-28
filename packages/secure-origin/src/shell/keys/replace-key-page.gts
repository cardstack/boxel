// The `replace-key` page: a new value for the key an operation sends, opened
// for that operation, on a card or a card type, as `enter-key` is. The page
// never names a key itself, and neither does the page that opened it: the
// realm server says which key fills each of the operation's credential slots,
// from the binding a call fills it from, and whether the service it is sent to
// rejected it. Replacing a key returns every grant of it the service rejected
// to use, so this is what a card's Reconnect opens.
//
// A slot filled by the user's own key, or by a key they share into the
// workspace, offers that key's replace form, saying how many workspaces the
// key is shared with, since replacing it changes it in all of them. When the
// service rejected any of the operation's keys, only the rejected ones are
// offered: a key it still accepts may be in use elsewhere, and is left as it
// is. A slot filled by a key someone else shares into the workspace can only
// be replaced by them: the page says so, and names who shared it to the
// workspace's direct writers, who see its shares already. A slot nothing is
// bound to says that. A replaced key's row stays, saying it is replaced.
import { on } from '@ember/modifier';
import type Owner from '@ember/owner';
import { schedule } from '@ember/runloop';
import Component from '@glimmer/component';
import { trackedObject } from '@ember/reactive/collections';

import { getKey, replaceKey, windowContext } from '../../security/keys.ts';
import BusyMessage from '../../components/busy-message.gts';
import Button from '../../components/button.gts';
import FieldContainer from '../../components/field-container.gts';
import KeyRound from '../../components/icons/key-round.gts';

import {
  failureMessage,
  isSignedOut,
  loadFailure,
  type LoadFailure,
} from './context.ts';
import { eq } from '../../helpers/truth-helpers.ts';

import type { SlotBound, WindowContext } from './context.ts';
import DonePage from './done-page.gts';
import EditPage from './edit-page.gts';
import KeyFields from './key-fields.gts';
import KeysWindow, { type KeysWindowAPI } from './keys-window.gts';
import LoadFailed from './load-failed.gts';
import OpenedForSummary from './opened-for-summary.gts';
import { contextRequest, openedFor } from './opened-for.ts';
import { addressOf } from './workspace-dropdown.gts';

// What the page does for one slot.
type SlotView =
  | {
      kind: 'replace';
      slot: string;
      key: { id: string; name: string };
      rejected: boolean;
      // The share's label, when the key is one the user shares into the
      // workspace.
      shareLabel?: string;
    }
  // One of the user's keys the service still accepts, beside one it rejected.
  | { kind: 'accepted'; slot: string; key: { id: string; name: string } }
  | {
      kind: 'someone-elses';
      slot: string;
      rejected: boolean;
      label?: string;
      suspended: boolean;
      owner?: string;
    }
  | { kind: 'unbound'; slot: string; shared: boolean };

function slotView(
  slot: { name: string; key: string; bound?: SlotBound | null },
  anyRejected: boolean,
): SlotView {
  let { bound } = slot;
  if (!bound) {
    return { kind: 'unbound', slot: slot.name, shared: slot.key === 'apiKey' };
  }
  if (bound.key && anyRejected && !bound.rejected) {
    return { kind: 'accepted', slot: slot.name, key: bound.key };
  }
  if (bound.key) {
    return {
      kind: 'replace',
      slot: slot.name,
      key: bound.key,
      rejected: bound.rejected,
      shareLabel: bound.share?.label,
    };
  }
  return {
    kind: 'someone-elses',
    slot: slot.name,
    rejected: bound.rejected,
    label: bound.share?.label,
    suspended: bound.share?.suspended ?? false,
    owner: bound.share?.owner,
  };
}

type State =
  | { name: 'loading' }
  | { name: 'load-failed'; failure: LoadFailure }
  | { name: 'ready'; context: WindowContext; slots: SlotView[] }
  | { name: 'done'; keyName: string; context: WindowContext };

class SlotPanel extends Component<{
  Args: {
    view: SlotView;
    context: WindowContext;
    // Whether the operation has more than one slot, so each is named.
    named: boolean;
    // Whether this slot's key has been replaced on this page.
    replaced: boolean;
    api: KeysWindowAPI;
    onReplaced: (key: { id: string; name: string }) => void;
  };
}> {
  <template>
    <section
      class='slot'
      data-test-replace-key-slot={{@view.slot}}
      data-test-replace-key-slot-kind={{@view.kind}}
    >
      {{#if @named}}
        <h2 class='slot-name'>{{@view.slot}}</h2>
      {{/if}}
      {{#if @replaced}}
        <FieldContainer @tag='div' @label='Key in use' @icon={{KeyRound}}>
          <p
            class='value'
            role='status'
            tabindex='-1'
            data-replace-key-replaced
            data-test-replace-key-replaced
          ><strong>{{this.keyName}}</strong>
            is replaced.</p>
        </FieldContainer>
      {{else if this.replacing}}
        <FieldContainer @tag='div' @label='Key in use' @icon={{KeyRound}}>
          <p class='value'>
            <strong
              data-test-replace-key-name
            >{{this.replacing.key.name}}</strong>
            {{#if this.replacing.shareLabel}}
              <span class='note'>Shared with
                <strong>{{@context.realm.name}}</strong>
                as “{{this.replacing.shareLabel}}”.</span>
            {{/if}}
            <span class='note' data-test-replace-key-where>
              {{#if (eq this.use.workspaces 1)}}
                One workspace uses this key. Replacing it switches that
                workspace to the new key right away, so make sure the new key is
                right for that workspace.
              {{else if this.use.workspaces}}
                {{this.use.workspaces}}
                workspaces use this key. Replacing it switches them all to the
                new key right away, so make sure all of these workspaces use the
                same key.
              {{else if this.use.known}}
                It isn’t shared with any workspace. Make sure the new key is for
                the same service.
              {{else}}
                Replacing this key switches every workspace that uses it to the
                new key right away, so make sure all of them use the same key.
              {{/if}}
            </span>
            {{#if this.replacing.rejected}}
              <span class='rejected' data-test-replace-key-rejected>
                {{this.serviceName}}
                rejected this key. Boxel isn’t sending it there until you
                replace it.
              </span>
            {{/if}}
          </p>
        </FieldContainer>
        <form
          novalidate
          {{on 'submit' this.save}}
          data-replace-key-form
          data-test-replace-key-form
        >
          <KeyFields @value={{this.form.value}} @onValue={{this.setValue}} />
          {{#if this.form.error}}
            <div class='keys-error' role='alert' data-test-keys-error>
              {{this.form.error}}
            </div>
          {{/if}}
          <div class='slot-actions'>
            <Button
              type='submit'
              @kind='primary'
              @disabled={{this.submitDisabled}}
              @loading={{this.form.saving}}
              data-test-replace-key-save
            >Replace key</Button>
          </div>
        </form>
      {{else if this.accepted}}
        <FieldContainer @tag='div' @label='Key in use' @icon={{KeyRound}}>
          <p class='message' data-test-replace-key-accepted>
            <strong>{{this.accepted.key.name}}</strong>
            still works:
            {{this.serviceName}}
            accepts it, so there’s nothing to replace.
          </p>
        </FieldContainer>
      {{else if this.someoneElses}}
        <FieldContainer @tag='div' @label='Key in use' @icon={{KeyRound}}>
          <p class='message' data-test-replace-key-not-yours>
            {{#if this.someoneElses.suspended}}
              The workspace’s key{{this.quotedLabel}}
              is suspended. Someone with direct write access to
              <strong>{{@context.realm.name}}</strong>
              can put a key of their own in its place.
            {{else}}
              {{#if this.someoneElses.rejected}}
                {{this.serviceName}}
                rejected the workspace’s key{{this.quotedLabel}}.
              {{else}}
                This request uses the workspace’s key{{this.quotedLabel}}.
              {{/if}}
              Only the person who shared it can replace it.
              {{#if this.someoneElses.owner}}
                Ask
                <strong
                  data-test-replace-key-owner
                >{{this.someoneElses.owner}}</strong>
                to replace it in their secure window.
              {{else}}
                Ask someone with direct write access to
                <strong>{{@context.realm.name}}</strong>
                (<span>{{addressOf @context.realm.url}}</span>) who shared it.
              {{/if}}
            {{/if}}
          </p>
        </FieldContainer>
      {{else}}
        <FieldContainer @tag='div' @label='Key in use' @icon={{KeyRound}}>
          <p class='message' data-test-replace-key-unbound>
            {{#if this.unboundShared}}
              No key is shared into
              <strong>{{@context.realm.name}}</strong>
              for this request yet.
            {{else}}
              None of your keys is approved for this request yet, so there is
              nothing to replace.
              {{#if @context.card}}
                <strong>{{@context.card.name}}</strong>
                asks you to approve one when it needs it.
              {{/if}}
            {{/if}}
          </p>
        </FieldContainer>
      {{/if}}
    </section>

    <style scoped>
      .slot {
        display: grid;
        gap: var(--boxel-sp-sm);
      }
      .slot-name {
        margin: 0;
        font-size: var(--boxel-font-size-sm);
        line-height: var(--boxel-line-height-sm);
        font-weight: 600;
      }
      .value,
      .message {
        margin: 0;
        padding-top: var(--boxel-sp-xs);
        font-size: var(--boxel-font-size-sm);
        line-height: var(--boxel-line-height-sm);
        overflow-wrap: anywhere;
      }
      .note,
      .rejected {
        display: block;
        margin-top: var(--boxel-sp-4xs);
        font-size: var(--boxel-font-size-xs);
        line-height: var(--boxel-line-height-xs);
      }
      .note {
        color: var(--muted-foreground);
      }
      .rejected {
        color: var(--destructive-ink, var(--boxel-danger));
        font-weight: 500;
      }
      form {
        display: grid;
        gap: var(--boxel-sp-sm);
      }
      .slot-actions {
        display: flex;
        justify-content: flex-end;
      }
      .keys-error {
        color: var(--destructive-ink, var(--boxel-danger));
        font-size: var(--boxel-font-size-xs);
        line-height: var(--boxel-line-height-xs);
        font-weight: 500;
      }
    </style>
  </template>

  private form = trackedObject({
    value: '',
    saving: false,
    error: undefined as string | undefined,
  });
  // How many workspaces the key is shared with, once the server has said.
  private use = trackedObject({ known: false, workspaces: 0 });

  constructor(owner: Owner, args: SlotPanel['args']) {
    super(owner, args);
    this.loadUse();
  }

  // If the key's shares can't be listed, the row says so in general terms
  // instead, and the replace is still offered.
  private async loadUse() {
    let view = this.replacing;
    if (!view) {
      return;
    }
    try {
      let key = await getKey(this.args.api.config, view.key.id);
      this.use.workspaces = key.sharedInto.length;
      this.use.known = true;
    } catch (e) {
      if (isSignedOut(e)) {
        this.args.api.signedOut();
      }
    }
  }

  private get accepted() {
    return this.args.view.kind === 'accepted' ? this.args.view : undefined;
  }

  private get keyName() {
    let { view } = this.args;
    return view.kind === 'replace' || view.kind === 'accepted'
      ? view.key.name
      : undefined;
  }

  // A share's label, quoted after "the workspace’s key", when the user may
  // see it.
  private get quotedLabel() {
    let label = this.someoneElses?.label;
    return label ? ` “${label}”` : '';
  }

  private get replacing() {
    return this.args.view.kind === 'replace' ? this.args.view : undefined;
  }
  private get someoneElses() {
    return this.args.view.kind === 'someone-elses' ? this.args.view : undefined;
  }
  private get unboundShared() {
    return this.args.view.kind === 'unbound' && this.args.view.shared;
  }

  // Who rejected the key: the service the operation sends it to, by the name
  // a person recognizes it by.
  private get serviceName() {
    return (
      this.args.context.operation?.destination?.registrableDomain ??
      'The service'
    );
  }

  private get submitDisabled() {
    return this.form.saving || !this.form.value;
  }

  private setValue = (value: string) => {
    this.form.value = value;
    this.form.error = undefined;
  };

  private save = async (event: Event) => {
    event.preventDefault();
    let view = this.replacing;
    if (this.submitDisabled || !view) {
      return;
    }
    this.form.saving = true;
    this.form.error = undefined;
    try {
      await replaceKey(this.args.api.config, {
        keyId: view.key.id,
        value: this.form.value,
      });
      // The value is gone from the page the moment the server has it.
      this.form.value = '';
      this.args.onReplaced(view.key);
    } catch (e) {
      if (isSignedOut(e)) {
        this.args.api.signedOut();
        return;
      }
      this.form.error = failureMessage(e);
    } finally {
      this.form.saving = false;
    }
  };
}

class ReplaceKey extends Component<{ Args: { api: KeysWindowAPI } }> {
  <template>
    {{#if this.loading}}
      <BusyMessage class='busy' @title='Loading…' />
    {{else if this.loadFailed}}
      <LoadFailed
        @heading='Replace a key'
        @failure={{this.loadFailed.failure}}
        @onRetry={{this.load}}
      />
    {{else if this.done}}
      <DonePage @heading='Key replaced' @onClose={{@api.close}}>Your key
        <strong data-test-keys-done-name>{{this.done.keyName}}</strong>
        is replaced. Nothing can read it back, here or anywhere in Boxel.
        {{#if this.done.context.card}}
          <span class='next' data-test-keys-done-next><strong
            >{{this.done.context.card.name}}</strong>
            sends the new key from its next request.</span>
        {{/if}}
      </DonePage>
    {{else if this.ready}}
      <EditPage @heading='Replace a key' data-test-replace-key>
        <:intro>The new key takes the old one’s place everywhere it is used. It
          is encrypted as soon as it is saved, and nothing can read it back.</:intro>
        <:default>
          <OpenedForSummary
            @context={{this.ready.context}}
            @reason={{this.opened.reason}}
          />
          {{#each this.ready.slots as |slot|}}
            <SlotPanel
              @view={{slot}}
              @context={{this.ready.context}}
              @named={{this.named}}
              @replaced={{this.isReplaced slot}}
              @api={{@api}}
              @onReplaced={{this.replaced}}
            />
          {{/each}}
        </:default>
      </EditPage>
    {{/if}}

    <style scoped>
      .next {
        display: block;
        margin-top: var(--boxel-sp-xs);
      }
      .busy {
        margin-top: var(--boxel-sp-xl);
      }
    </style>
  </template>

  private opened = openedFor();
  private page = trackedObject<{ state: State }>({
    state: { name: 'loading' },
  });

  constructor(owner: Owner, args: { api: KeysWindowAPI }) {
    super(owner, args);
    this.load();
  }

  private get loading() {
    return this.page.state.name === 'loading';
  }
  private get loadFailed() {
    return this.page.state.name === 'load-failed' ? this.page.state : undefined;
  }
  private get ready() {
    return this.page.state.name === 'ready' ? this.page.state : undefined;
  }
  private get done() {
    return this.page.state.name === 'done' ? this.page.state : undefined;
  }
  private get named() {
    return (this.ready?.slots.length ?? 0) > 1;
  }

  private load = async () => {
    let request = contextRequest(this.opened);
    this.page.state = { name: 'loading' };
    try {
      // The page is for an operation's keys, so a link naming none names
      // nothing it can show.
      if (!request || !('operation' in request) || !request.operation) {
        throw Object.assign(new Error('no operation to replace a key for'), {
          status: 404,
        });
      }
      let context = (await windowContext(this.args.api.config, {
        ...request,
        bindings: true,
      })) as WindowContext;
      let slots = context.operation?.slots ?? [];
      let anyRejected = slots.some((slot) => slot.bound?.rejected);
      this.page.state = {
        name: 'ready',
        context,
        slots: slots.map((slot) => slotView(slot, anyRejected)),
      };
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

  // Once every key the page offers to replace is replaced, the page says so
  // and closes the window. Until then a replaced key's row says it is
  // replaced, and focus moves to the next key's value, or else to that row.
  // A key filling two slots is replaced once.
  private replacedKeys = trackedObject<{ ids: string[] }>({ ids: [] });
  private isReplaced = (view: SlotView) =>
    view.kind === 'replace' && this.replacedKeys.ids.includes(view.key.id);
  private replaced = (key: { id: string; name: string }) => {
    let ready = this.ready;
    if (!ready) {
      return;
    }
    this.replacedKeys.ids = [...this.replacedKeys.ids, key.id];
    let remaining = ready.slots.filter(
      (view) => view.kind === 'replace' && !this.isReplaced(view),
    );
    if (remaining.length > 0) {
      schedule('afterRender', () => {
        let next =
          document.querySelector<HTMLElement>(
            '[data-replace-key-form] input',
          ) ??
          document.querySelector<HTMLElement>('[data-replace-key-replaced]');
        next?.focus();
      });
      return;
    }
    this.page.state = {
      name: 'done',
      keyName: key.name,
      context: ready.context,
    };
    this.args.api.close();
  };
}

export default class ReplaceKeyPage extends Component {
  <template>
    <KeysWindow @title='Boxel · Your keys' @page='replace-key' as |api|>
      <ReplaceKey @api={{api}} />
    </KeysWindow>
  </template>
}
