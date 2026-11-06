// One of the user's own keys' usage and limits, on its tile on the key page:
// closed until asked for, then what the key spent against its budgets, who
// used it and how, and its limits, which the owner changes in place, since
// this window is the owner's own. A usage that fails to load says so and
// offers to try again, rather than reading as no use.
import { registerDestructor } from '@ember/destroyable';
import { on } from '@ember/modifier';
import type Owner from '@ember/owner';
import Component from '@glimmer/component';
import { trackedObject } from '@ember/reactive/collections';

import { Disclosure } from '@cardstack/pretui/components/disclosure';
import { VisuallyHidden } from '@cardstack/pretui/components/visually-hidden';

import BusyMessage from '../../components/busy-message.gts';
import Button from '../../components/button.gts';
import { not } from '../../helpers/truth-helpers.ts';
import {
  keyUsage,
  setKeyLimits,
  type KeyLimitChanges,
  type KeyLimits,
  type KeyUsage,
  type ListedKey,
} from '../../security/keys.ts';

import { failureMessage, isSignedOut } from './context.ts';
import type { KeysWindowAPI } from './keys-window.gts';
import LimitsForm from './limits-form.gts';
import UsageSummary from './usage-summary.gts';

interface Signature {
  Args: {
    key: ListedKey;
    api: KeysWindowAPI;
    // Hands the key page a way to open this panel and bring it into view, as
    // a limit notice's See usage… does; and takes it back when the panel
    // goes.
    onRegister?: (keyId: string, show: (() => void) | undefined) => void;
  };
}

type State =
  | { name: 'closed' }
  | { name: 'loading' }
  | { name: 'failed'; message: string }
  | { name: 'open'; usage: KeyUsage };

export default class KeyUsagePanel extends Component<Signature> {
  <template>
    <div
      class='usage-panel'
      data-usage-panel={{@key.id}}
      data-test-key-usage-panel
    >
      <Disclosure
        class='disclosure'
        @size='s'
        @open={{not this.isClosed}}
        @onOpenChange={{this.toggle}}
        data-test-key-usage-toggle
      >
        <:trigger>Usage and limits<VisuallyHidden>
            for
            {{@key.name}}</VisuallyHidden></:trigger>
        <:default>
          {{#if this.loading}}
            <BusyMessage @title='Loading usage…' />
          {{else if this.failed}}
            <div class='failed' role='alert' data-test-key-usage-error>
              This key’s usage couldn’t be loaded:
              {{this.failed.message}}
              <Button
                @kind='text-only'
                @size='extra-small'
                data-test-key-usage-retry
                {{on 'click' this.load}}
              >Try again</Button>
            </div>
          {{else if this.open}}
            <div class='panel-body' data-test-key-usage-body>
              <UsageSummary @usage={{this.open.usage}} />
              <div class='limits'>
                <h4 class='heading'>Limits</h4>
                <LimitsForm
                  @limits={{this.open.usage.limits}}
                  @onSave={{this.saveLimits}}
                />
              </div>
            </div>
          {{/if}}
        </:default>
      </Disclosure>
    </div>
    <style scoped>
      /* The panel opens under its trigger with the panel's own gap. */
      .disclosure {
        row-gap: var(--boxel-sp-xs);
      }
      /* In the panel's text size, not the smaller one the disclosure sets
         for its trigger. */
      .panel-body {
        font-size: var(--boxel-font-size-sm);
        display: grid;
        gap: var(--boxel-sp-sm);
        padding: var(--boxel-sp-sm);
        border: 1px solid var(--border);
        border-radius: var(--boxel-border-radius);
        background: var(--card, var(--background));
      }
      .limits {
        display: grid;
        gap: var(--boxel-sp-xs);
        padding-top: var(--boxel-sp-sm);
        border-top: 1px solid var(--border);
      }
      .heading {
        margin: 0;
        font-size: var(--boxel-font-size-xs);
        font-weight: 600;
      }
      .failed {
        color: var(--destructive-ink, var(--boxel-danger));
        font-size: var(--boxel-font-size-xs);
      }
    </style>
  </template>

  private page = trackedObject<{ state: State }>({
    state: { name: 'closed' },
  });

  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);
    let { key, onRegister } = args;
    if (onRegister) {
      onRegister(key.id, this.show);
      registerDestructor(this, () => onRegister(key.id, undefined));
    }
  }

  // Opens the panel, unless it is open or opening, and moves focus to its
  // disclosure's button, which brings it into view. The button is drawn
  // whether the panel is open or not, so it can take focus at once.
  private show = () => {
    if (this.isClosed || this.failed) {
      this.load();
    }
    document
      .querySelector<HTMLElement>(
        `[data-usage-panel="${CSS.escape(this.args.key.id)}"] button[aria-expanded]`,
      )
      ?.focus();
  };

  private get isClosed() {
    return this.page.state.name === 'closed';
  }
  private get loading() {
    return this.page.state.name === 'loading';
  }
  private get failed() {
    return this.page.state.name === 'failed' ? this.page.state : undefined;
  }
  private get open() {
    return this.page.state.name === 'open' ? this.page.state : undefined;
  }

  private toggle = () => {
    if (this.isClosed) {
      this.load();
    } else {
      this.page.state = { name: 'closed' };
    }
  };

  private load = async () => {
    this.page.state = { name: 'loading' };
    try {
      let usage = await keyUsage(this.args.api.config, this.args.key.id);
      this.page.state = { name: 'open', usage };
    } catch (e) {
      if (isSignedOut(e)) {
        this.args.api.signedOut();
        return;
      }
      this.page.state = { name: 'failed', message: failureMessage(e) };
    }
  };

  // Saves the limits, then reads the usage again for the budgets they set.
  // The limits are saved once the change is, whether or not that read
  // succeeds; a usage that can't be read again keeps what it showed, with
  // the new limits.
  private saveLimits = async (
    changes: KeyLimitChanges,
  ): Promise<KeyLimits | string> => {
    let limits: KeyLimits;
    try {
      limits = await setKeyLimits(
        this.args.api.config,
        this.args.key.id,
        changes,
      );
    } catch (e) {
      if (isSignedOut(e)) {
        this.args.api.signedOut();
      }
      return failureMessage(e);
    }
    let open = this.open;
    if (open) {
      try {
        let usage = await keyUsage(this.args.api.config, this.args.key.id);
        this.page.state = { name: 'open', usage: { ...usage, limits } };
      } catch (e) {
        if (isSignedOut(e)) {
          this.args.api.signedOut();
        } else {
          this.page.state = {
            name: 'open',
            usage: { ...open.usage, limits },
          };
        }
      }
    }
    return limits;
  };
}
