import { registerDestructor } from '@ember/destroyable';
import type Owner from '@ember/owner';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';

import { on } from '@ember/modifier';

import { eq } from '@cardstack/boxel-ui/helpers';

import {
  CardDef,
  Component as CardComponent,
  contains,
  field,
} from '@cardstack/base/card-api';
import NumberField from '@cardstack/base/number';
import StringField from '@cardstack/base/string';

type Outcome = 'allowed' | 'blocked';

interface ProbeResult {
  id: string;
  outcome: Outcome;
  detail: string;
  expected: boolean;
  label: string;
}

interface Probe {
  ordinal: number;
  id: string;
  title: string;
  operation: string;
  run(target: Window): string | Promise<string>;
}

interface CapabilityHarness {
  readonly accessTokenCanary: string;
  patchRealmCard(): string;
  runHostCommand(): string;
}

type ProbeWindow = Window & {
  __boxelCapabilityDemo?: CapabilityHarness;
  eval(source: string): unknown;
};

const STORAGE_KEY = '__boxel_execution_capability_probe__';
const COOKIE_NAME = '__boxel_execution_capability_probe__';

const PROBES: readonly Probe[] = [
  {
    ordinal: 1,
    id: 'document-title',
    title: 'Read the Host document',
    operation: 'window.parent.document.title',
    run: (target) => target.document.title || '(untitled)',
  },
  {
    ordinal: 2,
    id: 'query-host-dom',
    title: 'Query the Host DOM',
    operation: "window.parent.document.querySelector('body')",
    run: (target) =>
      target.document.querySelector('body')?.tagName ?? 'not found',
  },
  {
    ordinal: 3,
    id: 'mutate-host-dom',
    title: 'Mutate the Host DOM',
    operation: 'window.parent.document.body.dataset',
    run: (target) => {
      let body = target.document.body;
      let previous = body.dataset.boxelCapabilityProbe;
      body.dataset.boxelCapabilityProbe = 'allowed';
      let result = body.dataset.boxelCapabilityProbe;
      restoreDataset(body, 'boxelCapabilityProbe', previous);
      return `round trip: ${result}`;
    },
  },
  {
    ordinal: 4,
    id: 'local-storage',
    title: 'Use Host local storage',
    operation: 'window.parent.localStorage',
    run: (target) => storageRoundTrip(target.localStorage),
  },
  {
    ordinal: 5,
    id: 'session-storage',
    title: 'Use Host session storage',
    operation: 'window.parent.sessionStorage',
    run: (target) => storageRoundTrip(target.sessionStorage),
  },
  {
    ordinal: 6,
    id: 'cookies',
    title: 'Plant a Host cookie',
    operation: 'window.parent.document.cookie',
    run: (target) => {
      let document = target.document;
      document.cookie = `${COOKIE_NAME}=allowed; Path=/; SameSite=Strict`;
      let allowed = document.cookie.includes(`${COOKIE_NAME}=allowed`);
      document.cookie = `${COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Strict`;
      if (!allowed) {
        throw new Error('cookie round trip was refused');
      }
      return 'cookie planted; removed';
    },
  },
  {
    ordinal: 7,
    id: 'host-location',
    title: 'Read the Host URL',
    operation: 'window.parent.location.href',
    run: (target) => target.location.href,
  },
  {
    ordinal: 8,
    id: 'computed-style',
    title: 'Inspect Host computed styles',
    operation: 'window.parent.getComputedStyle(document.body)',
    run: (target) =>
      `display: ${target.getComputedStyle(target.document.body).display}`,
  },
  {
    ordinal: 9,
    id: 'stylesheets',
    title: 'Inventory Host stylesheets',
    operation: 'window.parent.document.styleSheets',
    run: (target) => `${target.document.styleSheets.length} stylesheets`,
  },
  {
    ordinal: 10,
    id: 'credentialed-fetch',
    title: 'Make a credentialed Host request',
    operation: 'window.parent.fetch(window.parent.location.href)',
    run: async (target) => {
      let response = await target.fetch(target.location.href, {
        credentials: 'include',
        method: 'HEAD',
      });
      if (!response.ok) {
        throw new Error(`Host returned ${response.status}`);
      }
      return `HTTP ${response.status}`;
    },
  },
  {
    ordinal: 11,
    id: 'steal-host-secret',
    title: 'Steal a Host access token',
    operation: 'window.parent.__boxelCapabilityDemo.accessTokenCanary',
    run: (target) => {
      let token = capabilityHarness(target).accessTokenCanary;
      return `read synthetic canary …${token.slice(-6)}`;
    },
  },
  {
    ordinal: 12,
    id: 'modify-realm',
    title: 'Modify a realm card with Host authority',
    operation: 'window.parent.__boxelCapabilityDemo.patchRealmCard()',
    run: (target) => capabilityHarness(target).patchRealmCard(),
  },
  {
    ordinal: 13,
    id: 'privileged-command',
    title: 'Run a privileged Host command',
    operation: 'window.parent.__boxelCapabilityDemo.runHostCommand()',
    run: (target) => capabilityHarness(target).runHostCommand(),
  },
  {
    ordinal: 14,
    id: 'impersonate-ui',
    title: 'Impersonate Boxel with a Host overlay',
    operation: 'window.parent.document.body.append(fakeLogin)',
    run: (target) => {
      let overlay = target.document.createElement('div');
      overlay.setAttribute('role', 'dialog');
      overlay.dataset.boxelCapabilityProbe = 'fake-login';
      overlay.textContent = 'Synthetic Boxel sign-in overlay';
      target.document.body.append(overlay);
      let mounted = overlay.isConnected;
      overlay.remove();
      return `overlay mounted: ${mounted}; removed`;
    },
  },
  {
    ordinal: 15,
    id: 'execute-host-code',
    title: 'Execute injected code in the Host',
    operation: 'window.parent.eval(injectedSource)',
    run: (target) => {
      (target as ProbeWindow).eval(
        "document.body.dataset.boxelInjectedScript = 'executed'",
      );
      let result = target.document.body.dataset.boxelInjectedScript;
      delete target.document.body.dataset.boxelInjectedScript;
      if (result !== 'executed') {
        throw new Error('injected source did not execute');
      }
      return 'synthetic source executed; state removed';
    },
  },
  {
    ordinal: 16,
    id: 'install-keylogger',
    title: 'Install a Host keyboard listener',
    operation: 'window.parent.document.addEventListener(keydown)',
    run: (target) => {
      let captured = false;
      let listener = () => {
        captured = true;
      };
      target.document.addEventListener('keydown', listener);
      target.document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'SyntheticKey' }),
      );
      target.document.removeEventListener('keydown', listener);
      if (!captured) {
        throw new Error('synthetic keystroke was not captured');
      }
      return 'synthetic key captured; listener removed';
    },
  },
  {
    ordinal: 17,
    id: 'tamper-navigation',
    title: 'Tamper with Host navigation state',
    operation: 'window.parent.history.replaceState()',
    run: (target) => {
      let originalURL = target.location.href;
      let probeURL = new URL(originalURL);
      probeURL.hash = 'boxel-navigation-probe';
      target.history.replaceState(target.history.state, '', probeURL);
      let changed = target.location.hash === '#boxel-navigation-probe';
      target.history.replaceState(target.history.state, '', originalURL);
      if (!changed) {
        throw new Error('Host navigation state did not change');
      }
      return 'URL changed; original restored';
    },
  },
  {
    ordinal: 18,
    id: 'install-form-skimmer',
    title: 'Install a Host form skimmer',
    operation: 'window.parent.document.addEventListener(submit)',
    run: (target) => {
      let captured = false;
      let listener = (event: Event) => {
        event.preventDefault();
        captured = true;
      };
      target.document.addEventListener('submit', listener);
      let form = target.document.createElement('form');
      target.document.body.append(form);
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
      form.remove();
      target.document.removeEventListener('submit', listener);
      if (!captured) {
        throw new Error('synthetic form submission was not captured');
      }
      return 'synthetic submission captured; skimmer removed';
    },
  },
  {
    ordinal: 19,
    id: 'plant-host-beacon',
    title: 'Plant a tracking beacon in the Host DOM',
    operation: 'window.parent.document.body.append(trackingPixel)',
    run: (target) => {
      let beacon = target.document.createElement('img');
      // A data URL proves Host DOM injection without making an outbound
      // request from this security demonstration.
      beacon.src =
        'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
      beacon.dataset.boxelCapabilityProbe = 'tracking-beacon';
      target.document.body.append(beacon);
      let planted = beacon.isConnected;
      beacon.remove();
      return `local-only beacon planted: ${planted}; removed`;
    },
  },
  {
    ordinal: 20,
    id: 'plant-persistence-hook',
    title: 'Plant a persistent Host event hook',
    operation: 'window.parent.addEventListener(boxel-session-event)',
    run: (target) => {
      let activated = false;
      let listener = () => {
        activated = true;
      };
      target.addEventListener('boxel-session-event', listener);
      target.dispatchEvent(new Event('boxel-session-event'));
      target.removeEventListener('boxel-session-event', listener);
      if (!activated) {
        throw new Error('synthetic persistence hook did not activate');
      }
      return 'synthetic hook activated; listener removed';
    },
  },
];

class Isolated extends CardComponent<typeof ExecutionCapabilityProbe> {
  private readonly mode = window.parent === window ? 'Direct' : 'Sandbox';
  private readonly expectedOutcome: Outcome =
    this.mode === 'Direct' ? 'allowed' : 'blocked';
  private readonly uninstallHarness = installHarness();

  @tracked private results: ProbeResult[] = [];

  constructor(owner: Owner, args: any) {
    super(owner, args);
    registerDestructor(this, this.uninstallHarness);
    void this.run();
  }

  private async run(): Promise<void> {
    let results: ProbeResult[] = [];
    for (let probe of PROBES) {
      let outcome: Outcome;
      let detail: string;
      try {
        detail = await probe.run(window.parent);
        outcome = 'allowed';
      } catch (error) {
        outcome = 'blocked';
        detail = error instanceof Error ? error.message : String(error);
      }
      let expected = outcome === this.expectedOutcome;
      results.push({
        id: probe.id,
        outcome,
        detail,
        expected,
        label: expected
          ? outcome === 'allowed'
            ? 'Succeeded'
            : 'Denied'
          : outcome === 'allowed'
            ? 'Unexpected access'
            : 'Unexpected denial',
      });
      this.results = [...results];
    }
  }

  private get rows() {
    return PROBES.map((probe) => ({
      probe,
      result: this.results.find((result) => result.id === probe.id),
    }));
  }

  private get passedCount(): number {
    return this.results.filter((result) => result.expected).length;
  }

  private get probeCount(): number {
    return PROBES.length;
  }

  private get complete(): boolean {
    return this.results.length === PROBES.length;
  }

  @action
  private recordApprovedWrite(): void {
    this.args.model.approvedWrites =
      (this.args.model.approvedWrites ?? 0) + 1;
  }

  <template>
    <article
      class='probe-card mode-{{this.mode}}'
      data-execution-probe-mode={{this.mode}}
    >
      <header>
        <div>
          <p class='eyebrow'>EXECUTION: {{this.mode}}</p>
          <h2>
            {{#if (eq this.mode 'Direct')}}
              Trusted code has Host authority
            {{else}}
              Untrusted code meets the browser boundary
            {{/if}}
          </h2>
        </div>
        <div class='score {{if this.complete "is-complete"}}'>
          <strong>{{this.passedCount}} / {{this.probeCount}}</strong>
          <span>{{if this.complete 'expected results' 'running probes'}}</span>
        </div>
      </header>

      <p class='explanation'>
        {{#if (eq this.mode 'Direct')}}
          This delegated card is Host-authorized. Its reversible attempts
          visibly succeed because Direct deliberately carries Host authority.
        {{else}}
          The identical delegated card runs in the isolated child. Its attempts
          target the parent Host and must be denied.
        {{/if}}
      </p>

      <section class='granted-document' aria-label='Approved card data'>
        <div>
          <p class='granted-eyebrow'>APPROVED DOCUMENT CAPABILITY</p>
          <h3>{{@model.label}}</h3>
          <p class='approved-note'>{{@model.approvedNote}}</p>
        </div>
        <button type='button' {{on 'click' this.recordApprovedWrite}}>
          Write approved data
          <strong>{{@model.approvedWrites}}</strong>
        </button>
      </section>

      <ol>
        {{#each this.rows as |row|}}
          <li data-capability-probe={{row.probe.id}}>
            <span class='ordinal'>{{row.probe.ordinal}}</span>
            <div class='probe-copy'>
              <h3>{{row.probe.title}}</h3>
              <code>{{row.probe.operation}}</code>
            </div>
            {{#if row.result}}
              <div
                class='result
                  {{if row.result.expected "is-expected" "is-unexpected"}}'
                data-capability-outcome={{row.result.outcome}}
              >
                <strong>{{row.result.label}}</strong>
                <span>{{row.result.detail}}</span>
              </div>
            {{else}}
              <div class='result is-pending'>
                <strong>Running…</strong>
              </div>
            {{/if}}
          </li>
        {{/each}}
      </ol>

      <footer>
        Synthetic canaries only · every DOM change is reversed · no real realm
        write or outbound beacon occurs
      </footer>
    </article>

    <style scoped>
      .probe-card {
        box-sizing: border-box;
        min-width: 0;
        overflow: hidden;
        border: 1px solid #ccc7b8;
        border-radius: 1rem;
        background: #fff;
        color: #171714;
        font-family: var(--boxel-font-family, sans-serif);
      }

      header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        padding: 1.25rem;
        background: #171714;
        color: #fff;
      }

      .mode-Sandbox header {
        background: #402118;
      }

      .eyebrow {
        margin: 0 0 0.35rem;
        color: #6ff0ba;
        font-family: monospace;
        font-size: 0.7rem;
        font-weight: 800;
        letter-spacing: 0.1em;
      }

      .mode-Sandbox .eyebrow {
        color: #ffb39a;
      }

      h2,
      h3,
      p {
        margin: 0;
      }

      h2 {
        font-size: 1.15rem;
        line-height: 1.15;
      }

      .score {
        flex: 0 0 auto;
        min-width: 6.5rem;
        padding: 0.55rem 0.75rem;
        border: 1px solid rgb(255 255 255 / 28%);
        border-radius: 0.65rem;
        text-align: right;
      }

      .score.is-complete {
        border-color: #6ff0ba;
        background: rgb(111 240 186 / 14%);
      }

      .mode-Sandbox .score.is-complete {
        border-color: #ffb39a;
        background: rgb(255 179 154 / 14%);
      }

      .score strong,
      .score span {
        display: block;
      }

      .score strong {
        font-family: monospace;
        font-size: 1rem;
      }

      .score span {
        margin-top: 0.15rem;
        color: #c8c5bb;
        font-size: 0.65rem;
        text-transform: uppercase;
      }

      .explanation {
        padding: 0.85rem 1.25rem;
        border-bottom: 1px solid #e8e4da;
        background: #f7f5ef;
        color: #5f5a4e;
        font-size: 0.8rem;
        line-height: 1.45;
      }

      .granted-document {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        padding: 1rem 1.25rem;
        border-bottom: 1px solid #d7d1c2;
        background: #fffdf7;
      }

      .granted-eyebrow {
        margin-bottom: 0.2rem;
        color: #706959;
        font-family: monospace;
        font-size: 0.62rem;
        font-weight: 800;
        letter-spacing: 0.08em;
      }

      .approved-note {
        margin-top: 0.25rem;
        color: #625d51;
        font-size: 0.72rem;
        line-height: 1.35;
      }

      button {
        display: flex;
        flex: 0 0 auto;
        align-items: center;
        gap: 0.7rem;
        padding: 0.65rem 0.75rem;
        border: 1px solid #171714;
        border-radius: 0.6rem;
        background: #fff;
        color: #171714;
        cursor: pointer;
        font: 700 0.7rem/1 var(--boxel-font-family, sans-serif);
      }

      button:hover {
        background: #171714;
        color: #fff;
      }

      button strong {
        display: grid;
        min-width: 1.65rem;
        height: 1.65rem;
        place-items: center;
        border-radius: 999px;
        background: #6ff0ba;
        color: #171714;
        font-family: monospace;
      }

      ol {
        margin: 0;
        padding: 0;
        list-style: none;
      }

      li {
        display: grid;
        grid-template-columns: 1.5rem minmax(0, 1fr) minmax(9rem, 0.8fr);
        align-items: center;
        gap: 0.65rem;
        padding: 0.75rem 1rem;
        border-bottom: 1px solid #eeeae1;
      }

      .ordinal {
        display: grid;
        width: 1.5rem;
        height: 1.5rem;
        place-items: center;
        border-radius: 50%;
        background: #292823;
        color: #fff;
        font-family: monospace;
        font-size: 0.65rem;
      }

      .probe-copy {
        min-width: 0;
      }

      h3 {
        font-size: 0.8rem;
      }

      code {
        display: block;
        overflow: hidden;
        margin-top: 0.2rem;
        color: #726d61;
        font-family: monospace;
        font-size: 0.65rem;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .result {
        min-width: 0;
        padding: 0.5rem 0.65rem;
        border: 1px solid #98d7bb;
        border-radius: 0.55rem;
        background: #eaf9f2;
        color: #075f40;
      }

      .mode-Sandbox .result.is-expected {
        border-color: #efb39f;
        background: #fff0ea;
        color: #873016;
      }

      .result.is-unexpected {
        border-color: #d8a300;
        background: #fff4bc;
        color: #5f4700;
        box-shadow: inset 0 0 0 1px #d8a300;
      }

      .result.is-pending {
        border-color: #d3cfc4;
        background: #f7f5ef;
        color: #716c61;
      }

      .result strong,
      .result span {
        display: block;
      }

      .result strong {
        font-family: monospace;
        font-size: 0.65rem;
        letter-spacing: 0.06em;
        text-transform: uppercase;
      }

      .result span {
        overflow: hidden;
        margin-top: 0.15rem;
        font-size: 0.65rem;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      footer {
        padding: 0.8rem 1rem;
        background: #f7f5ef;
        color: #6c675b;
        font-family: monospace;
        font-size: 0.65rem;
        line-height: 1.4;
        text-align: center;
        text-transform: uppercase;
      }

      @media (max-width: 40rem) {
        li {
          grid-template-columns: 1.5rem minmax(0, 1fr);
        }

        .result {
          grid-column: 2;
        }
      }
    </style>
  </template>
}

export class ExecutionCapabilityProbe extends CardDef {
  static displayName = 'Execution Capability Probe';

  @field label = contains(StringField);
  @field approvedNote = contains(StringField);
  @field approvedWrites = contains(NumberField);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: ExecutionCapabilityProbe) {
      return this.label ?? 'Execution Capability Probe';
    },
  });

  static isolated = Isolated;
  static embedded = Isolated;
}

function installHarness(): () => void {
  let target = window as ProbeWindow;
  let previous = target.__boxelCapabilityDemo;
  target.__boxelCapabilityDemo = Object.freeze({
    accessTokenCanary: 'synthetic-token-canary-7D3A9F',
    patchRealmCard: () => 'simulated realm patch; no write performed',
    runHostCommand: () => 'simulated privileged command accepted',
  });
  return () => {
    if (previous) {
      target.__boxelCapabilityDemo = previous;
    } else {
      delete target.__boxelCapabilityDemo;
    }
  };
}

function capabilityHarness(target: Window): CapabilityHarness {
  let harness = (target as ProbeWindow).__boxelCapabilityDemo;
  if (!harness) {
    throw new Error('Host capability harness is unavailable');
  }
  return harness;
}

function storageRoundTrip(storage: Storage): string {
  let previous = storage.getItem(STORAGE_KEY);
  storage.setItem(STORAGE_KEY, 'allowed');
  let result = storage.getItem(STORAGE_KEY);
  if (previous === null) {
    storage.removeItem(STORAGE_KEY);
  } else {
    storage.setItem(STORAGE_KEY, previous);
  }
  if (result !== 'allowed') {
    throw new Error('storage round trip was refused');
  }
  return `round trip: ${result}`;
}

function restoreDataset(
  element: HTMLElement,
  key: string,
  previous: string | undefined,
): void {
  if (previous === undefined) {
    delete element.dataset[key];
  } else {
    element.dataset[key] = previous;
  }
}
