// One of the user's own keys' usage and limits, on its tile on the key page:
// closed until asked for, then what the key spent against its budgets, who
// used it and how, and its limits, which the owner changes in place, since
// this window is the owner's own. A usage that fails to load says so and
// offers to try again, rather than reading as no use.
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { trackedObject } from '@ember/reactive/collections';

import BusyMessage from '../../components/busy-message.gts';
import Button from '../../components/button.gts';
import {
  keyUsage,
  setKeyLimits,
  type KeyLimitChanges,
  type KeyUsage,
  type ListedKey,
} from '../../security/keys.ts';

import { failureMessage, isSignedOut } from './context.ts';
import type { KeysWindowAPI } from './keys-window.gts';
import LimitsForm from './limits-form.gts';
import UsageSummary from './usage-summary.gts';

interface Signature {
  Args: { key: ListedKey; api: KeysWindowAPI };
}

type State =
  | { name: 'closed' }
  | { name: 'loading' }
  | { name: 'failed'; message: string }
  | { name: 'open'; usage: KeyUsage };

export default class KeyUsagePanel extends Component<Signature> {
  <template>
    <div class='usage-panel' data-test-key-usage-panel>
      <Button
        class='toggle'
        @kind='text-only'
        @size='extra-small'
        aria-expanded={{if this.isClosed 'false' 'true'}}
        aria-describedby='key-name-{{@key.id}}'
        data-test-key-usage-toggle
        {{on 'click' this.toggle}}
      >{{if this.isClosed 'Usage and limits' 'Hide usage and limits'}}</Button>
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
        <UsageSummary @usage={{this.open.usage}} />
        <h4 class='heading'>Limits</h4>
        <LimitsForm
          @limits={{this.open.usage.limits}}
          @onSave={{this.saveLimits}}
        />
      {{/if}}
    </div>
    <style scoped>
      .usage-panel {
        display: grid;
        gap: var(--boxel-sp-xs);
      }
      .toggle {
        justify-self: start;
      }
      .heading {
        margin: var(--boxel-sp-xs) 0 0;
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

  private saveLimits = async (
    changes: KeyLimitChanges,
  ): Promise<string | undefined> => {
    let open = this.open;
    try {
      let limits = await setKeyLimits(
        this.args.api.config,
        this.args.key.id,
        changes,
      );
      if (open) {
        let usage = await keyUsage(this.args.api.config, this.args.key.id);
        this.page.state = { name: 'open', usage: { ...usage, limits } };
      }
      return undefined;
    } catch (e) {
      if (isSignedOut(e)) {
        this.args.api.signedOut();
        return undefined;
      }
      return failureMessage(e);
    }
  };
}
