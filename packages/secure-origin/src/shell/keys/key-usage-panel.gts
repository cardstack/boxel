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

import BusyMessage from '../../components/busy-message.gts';
import Button from '../../components/button.gts';
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
    // a limit notice about the key does; and takes it back when the panel
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
      {{! A disclosure, drawn as the usage's own "Details this month" is: a
          marker that turns as it opens, with the same name either way. }}
      <button
        type='button'
        class='toggle'
        aria-expanded={{if this.isClosed 'false' 'true'}}
        aria-describedby='key-name-{{@key.id}}'
        data-test-key-usage-toggle
        {{on 'click' this.toggle}}
      >Usage and limits</button>
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
    </div>
    <style scoped>
      .usage-panel {
        display: grid;
        gap: var(--boxel-sp-xs);
      }
      .toggle {
        justify-self: start;
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-4xs);
        padding: 0;
        border: none;
        background: none;
        color: inherit;
        font: inherit;
        font-size: var(--boxel-font-size-xs);
        font-weight: 600;
        cursor: pointer;
      }
      .toggle::before {
        content: '';
        width: 0;
        height: 0;
        border-top: 0.3em solid transparent;
        border-bottom: 0.3em solid transparent;
        border-left: 0.45em solid currentColor;
        transition: transform 0.15s ease;
      }
      .toggle[aria-expanded='true']::before {
        transform: rotate(90deg);
      }
      .toggle:focus-visible {
        outline: 2px solid var(--ring, var(--boxel-highlight));
        outline-offset: 2px;
        border-radius: var(--boxel-border-radius-xs, 2px);
      }
      .panel-body {
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
  // disclosure, which brings it into view.
  private show = () => {
    if (this.isClosed || this.failed) {
      this.load();
    }
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLElement>(
          `[data-usage-panel="${CSS.escape(this.args.key.id)}"] > .toggle`,
        )
        ?.focus(),
    );
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
