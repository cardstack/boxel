import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type RouterService from '@ember/routing/router-service';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { eq } from '@cardstack/boxel-ui/helpers';
import { BoxelButton } from '@cardstack/boxel-ui/components';

import type { RunTestsResponse } from '@cardstack/runtime-common';

import type LoaderService from '../../../services/loader-service';
import type NetworkService from '../../../services/network';
import type RealmService from '../../../services/realm';

type TestStatus = 'idle' | 'running' | 'pass' | 'fail';

class TestEntry {
  name: string;
  @tracked status: TestStatus = 'idle';
  @tracked errorMessage: string | undefined;

  constructor(name: string) {
    this.name = name;
  }
}

interface TestRunnerPanelSignature {
  Args: {
    moduleUrl: string;
    realmUrl: string;
  };
}

export default class TestRunnerPanel extends Component<TestRunnerPanelSignature> {
  @service declare private loaderService: LoaderService;
  @service declare private network: NetworkService;
  @service declare private realm: RealmService;
  @service declare private router: RouterService;

  @tracked private tests: TestEntry[] = [];
  @tracked private isRunning = false;
  @tracked private loadError: string | null = null;

  constructor(owner: unknown, args: TestRunnerPanelSignature['Args']) {
    super(owner, args);
    void this.#discoverTests();
  }

  async #discoverTests() {
    this.loadError = null;
    try {
      let names: string[] = [];

      (globalThis as any).QUnit = {
        test(name: string) {
          names.push(name);
        },
        module(_name: string, optionsOrFn?: any, maybeFn?: any) {
          let fn = typeof optionsOrFn === 'function' ? optionsOrFn : maybeFn;
          if (fn) fn({ beforeEach() {}, afterEach() {} });
        },
      };

      let bust = new URL(this.args.moduleUrl);
      bust.searchParams.set('_t', String(Date.now()));
      await this.loaderService.loader.import(bust.toString());
      this.tests = names.map((name) => new TestEntry(name));
    } catch (e: unknown) {
      this.loadError = e instanceof Error ? e.message : String(e);
    } finally {
      (globalThis as any).QUnit = undefined;
    }
  }

  @action async runAll() {
    await this.#runTests();
  }

  @action async runSingle(entry: TestEntry) {
    await this.#runTests(entry.name);
  }

  async #runTests(filter?: string) {
    this.isRunning = true;

    let toRun = filter
      ? this.tests.filter((t) => t.name === filter)
      : this.tests;
    for (let entry of toRun) {
      entry.status = 'running';
      entry.errorMessage = undefined;
    }

    try {
      let serverUrl = new URL('/_run-tests', this.args.realmUrl).href;
      // authorizationMiddleware keys tokens by realm URL prefix, so it won't
      // match /_run-tests. Retrieve the token for the realm explicitly instead.
      let token = this.realm.token(this.args.realmUrl);
      let response = await this.network.authedFetch(serverUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/vnd.api+json',
          ...(token ? { Authorization: token } : {}),
        },
        body: JSON.stringify({
          data: {
            attributes: {
              moduleUrl: this.args.moduleUrl,
              realm: this.args.realmUrl,
              ...(filter ? { filter } : {}),
            },
          },
        }),
      });

      if (!response.ok) {
        let text = await response.text();
        throw new Error(`Test run failed (${response.status}): ${text}`);
      }

      let json = await response.json();
      let results: RunTestsResponse = json.data.attributes;

      for (let result of results.tests) {
        let entry = this.tests.find((t) => t.name === result.name);
        if (!entry) continue;
        entry.status = result.status === 'pass' ? 'pass' : 'fail';
        entry.errorMessage = result.error?.message;
      }
    } catch (e: unknown) {
      for (let entry of toRun) {
        if (entry.status === 'running') {
          entry.status = 'fail';
          entry.errorMessage = e instanceof Error ? e.message : String(e);
        }
      }
    } finally {
      this.isRunning = false;
    }
  }

  get passedCount() {
    return this.tests.filter((t) => t.status === 'pass').length;
  }

  get failedCount() {
    return this.tests.filter((t) => t.status === 'fail').length;
  }

  get hasResults() {
    return this.tests.some((t) => t.status === 'pass' || t.status === 'fail');
  }

  @action testRunnerUrl(testName?: string): string {
    let path = this.router.urlFor('test-runner', {
      queryParams: {
        module: this.args.moduleUrl,
        nonce: String(Date.now()),
        ...(testName ? { filter: testName } : {}),
      },
    });
    return `${window.location.origin}${path}`;
  }

  <template>
    <div class='test-runner-panel' data-test-test-runner-panel>
      <div class='test-runner-toolbar'>
        <BoxelButton
          @kind='primary'
          @size='small'
          @loading={{this.isRunning}}
          @disabled={{this.isRunning}}
          {{on 'click' this.runAll}}
          data-test-run-all-button
        >
            {{if this.isRunning 'Running…' 'Run All'}}
        </BoxelButton>

        {{#if this.hasResults}}
          <span
            class='summary {{if (eq this.failedCount 0) "pass" "fail"}}'
            data-test-test-summary
          >
            {{this.passedCount}}/{{this.tests.length}} passed
          </span>
        {{/if}}
      </div>

      {{#if this.loadError}}
        <div class='run-error' data-test-run-error>
          <strong>Error:</strong> {{this.loadError}}
        </div>
      {{/if}}

      <ul class='test-list' data-test-test-list>
        {{#each this.tests as |entry|}}
          <li
            class='test-item {{entry.status}}'
            data-test-test-item={{entry.name}}
          >
            <span class='status-icon'>
              {{if (eq entry.status 'pass') '✓'
                (if (eq entry.status 'fail') '✗'
                  (if (eq entry.status 'running') '…' '·'))}}
            </span>
            <span class='test-name'>
              {{entry.name}}
              <a
                class='open-link'
                href={{this.testRunnerUrl entry.name}}
                target='_blank'
                rel='noopener noreferrer'
                title='Open in test runner'
              >↗</a>
            </span>
            <BoxelButton
              @kind='secondary'
              @size='extra-small'
              class='rerun-button'
              @loading={{eq entry.status 'running'}}
              @disabled={{this.isRunning}}
              {{on 'click' (fn this.runSingle entry)}}
              data-test-rerun-button={{entry.name}}
            >
              {{if (eq entry.status 'running') 'Running…' 'Run'}}
            </BoxelButton>
            {{#if entry.errorMessage}}
              <pre class='test-error'>{{entry.errorMessage}}</pre>
            {{/if}}
          </li>
        {{/each}}
      </ul>
    </div>

    <style scoped>
      .test-runner-panel {
        padding: var(--boxel-sp-xs);
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
        background-color: var(--code-mode-panel-background-color);
        min-height: 100%;
      }

      .test-runner-toolbar {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        flex-wrap: wrap;
      }

      .summary {
        font: var(--boxel-font-sm);
        font-weight: 600;
      }

      .summary.pass {
        color: var(--boxel-teal);
      }

      .summary.fail {
        color: var(--boxel-red);
      }

      .run-error {
        font: var(--boxel-font-sm);
        color: var(--boxel-red);
        background: var(--boxel-100);
        padding: var(--boxel-sp-xs);
        border-radius: var(--boxel-border-radius);
      }

      .test-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xxs);
      }

      .test-item {
        display: grid;
        grid-template-columns: auto 1fr auto;
        grid-template-rows: auto auto;
        align-items: center;
        gap: var(--boxel-sp-xxs) var(--boxel-sp-xs);
        padding: var(--boxel-sp-xs);
        border-radius: var(--boxel-border-radius);
        background: var(--boxel-100);
        font: var(--boxel-font-sm);
      }

      .test-item {
        border-left: 3px solid transparent;
      }

      .test-item.pass {
        border-left-color: var(--boxel-teal);
      }

      .test-item.fail {
        border-left-color: var(--boxel-red);
      }

      .test-item.running {
        border-left-color: var(--boxel-highlight);
      }

      .status-icon {
        font-weight: bold;
        color: var(--boxel-450);
      }

      .test-item.pass .status-icon {
        color: var(--boxel-teal);
      }

      .test-item.fail .status-icon {
        color: var(--boxel-red);
      }

      .test-item.running .status-icon {
        color: var(--boxel-highlight);
      }

      .test-name {
        overflow-wrap: anywhere;
      }

      .open-link {
        margin-left: var(--boxel-sp-xxs);
        color: var(--boxel-450);
        text-decoration: none;
        font-size: 11px;
        opacity: 0.6;
      }

      .open-link:hover {
        opacity: 1;
        color: var(--boxel-highlight);
      }

      .rerun-button {
        justify-self: end;
      }

      .test-error {
        grid-column: 1 / -1;
        font: var(--boxel-font-xs);
        color: var(--boxel-red);
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        margin: 0;
        padding: var(--boxel-sp-xxs);
        background: var(--boxel-200);
        border-radius: var(--boxel-border-radius-xs);
      }
    </style>
  </template>
}
