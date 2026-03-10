import Route from '@ember/routing/route';
import type RouterService from '@ember/routing/router-service';
import { getOwner } from '@ember/owner';
import { get, getProperties, set, setProperties } from '@ember/object';
import { run } from '@ember/runloop';
import { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';

import QUnit from 'qunit';
import type { Assert } from 'qunit';

import {
  clearRender,
  setContext,
  setupRenderingContext,
  teardownContext,
} from '@ember/test-helpers';

import { registerBoxelTransitionTo } from '../utils/register-boxel-transition';

import type { RunTestsResponse, TestResult } from '@cardstack/runtime-common';

import type LoaderService from '../services/loader-service';

export class TestRunState {
  @tracked status: 'pending' | 'ready' | 'error' = 'pending';
  @tracked results: RunTestsResponse | null = null;
  @tracked errorMessage: string | null = null;

  constructor(readonly nonce: string) {}

  get prerenderStatus(): 'ready' | 'error' | undefined {
    if (this.status === 'ready') return 'ready';
    if (this.status === 'error') return 'error';
    return undefined;
  }

  get resultsString(): string | null {
    return this.results ? JSON.stringify(this.results) : null;
  }
}

export type TestRunnerModel = TestRunState;

export default class TestRunnerRoute extends Route<TestRunnerModel> {
  @service declare router: RouterService;
  @service declare loaderService: LoaderService;

  // Hold the rendering context so we can tear it down when the route exits,
  // not when the test run completes — this keeps the last rendered card
  // visible in #ember-testing alongside the test results.
  #renderingContext: any = null;

  queryParams = {
    module: { refreshModel: false },
    nonce: { refreshModel: false },
    filter: { refreshModel: false },
  };

  async beforeModel() {
    registerBoxelTransitionTo(this.router);
    (globalThis as any).__boxelRenderContext = true;

    // Inject a layout <style> that makes body a flex row so the Ember root
    // view (sidebar) and #ember-testing (content) sit side by side naturally,
    // without any fixed/absolute positioning.
    if (!document.getElementById('test-runner-layout-style')) {
      let style = document.createElement('style');
      style.id = 'test-runner-layout-style';
      style.textContent = `
        html, body {
          height: 100%; margin: 0; padding: 0;
          display: flex; overflow: hidden;
        }
        body > .ember-view {
          width: 340px; flex-shrink: 0;
          height: 100vh; overflow-y: auto;
          border-right: 1px solid #ddd;
        }
        #ember-testing {
          flex: 1; height: 100vh;
          overflow: auto; padding: 1rem;
          box-sizing: border-box; background: #fff;
        }
      `;
      document.head.appendChild(style);
    }

    // Create #ember-testing as a body sibling of the Ember root view so
    // Glimmer never owns or clears its children during reconciliation.
    if (!document.getElementById('ember-testing')) {
      let el = document.createElement('div');
      el.id = 'ember-testing';
      document.body.appendChild(el);
    }
  }

  async deactivate() {
    (globalThis as any).__boxelRenderContext = undefined;
    if (this.#renderingContext) {
      await teardownContext(this.#renderingContext);
      this.#renderingContext = null;
    }
    document.getElementById('ember-testing')?.remove();
    document.getElementById('test-runner-layout-style')?.remove();
  }

  model(params: {
    module?: string;
    nonce?: string;
    filter?: string;
  }): TestRunnerModel {
    let nonce = params.nonce ?? 'unknown';
    let moduleUrl = params.module ?? null;
    let filter =
      typeof params.filter === 'string' && params.filter.trim().length > 0
        ? params.filter.trim()
        : null;
    let model = new TestRunState(nonce);
    void this.#runTests(model, moduleUrl, filter);
    return model;
  }

  async #runTests(
    model: TestRunState,
    moduleUrl: string | null,
    filter: string | null,
  ) {
    if (!moduleUrl) {
      model.errorMessage = 'Missing required query param: module';
      model.status = 'error';
      return;
    }

    // Build a minimal TestContext backed by the live Ember owner so that
    // @ember/test-helpers' render() and settled() work inside realm tests,
    // exactly like they do in the host's own renderingTests.
    // The #ember-testing div in the template gives getRootElement() a target.
    let context: any = { owner: getOwner(this) };
    context.set = (key: string, value: unknown) =>
      run(() => set(context, key, value));
    context.setProperties = (hash: Record<string, unknown>) =>
      run(() => setProperties(context, hash));
    context.get = (key: string) => get(context, key);
    context.getProperties = (...args: string[]) =>
      getProperties(context, ...args);
    context.pauseTest = () => new Promise(() => {});
    context.resumeTest = () => {};

    // Wait for the matrix SDK to finish loading so that services like
    // defaultWritableRealm (which accesses matrixService.userName) don't throw.
    let matrixService = (getOwner(this) as any)?.lookup('service:matrix-service');
    if (matrixService?.ready) {
      await matrixService.ready;
    }

    setContext(context);
    await setupRenderingContext(context);
    this.#renderingContext = context;

    type HookFn = () => Promise<void> | void;
    let originalQUnitTest = QUnit.test;
    let originalQUnitModule = (QUnit as any).module;
    try {
      // Patch QUnit.test so that realm test files using
      // `import { test } from 'qunit'` have their registrations collected here
      // rather than queued into QUnit's own async runner.
      let registeredTests: Array<{
        name: string;
        fn: (assert: Assert) => Promise<void> | void;
        beforeEach: HookFn[];
        afterEach: HookFn[];
      }> = [];

      // Track hooks registered in the currently-executing module callback.
      let currentBeforeEach: HookFn[] = [];
      let currentAfterEach: HookFn[] = [];

      (QUnit as any).module = (
        _name: string,
        optionsOrFn?: any,
        maybeFn?: any,
      ) => {
        let fn = typeof optionsOrFn === 'function' ? optionsOrFn : maybeFn;
        if (!fn) return;
        let beforeEach: HookFn[] = [];
        let afterEach: HookFn[] = [];
        let prev = { beforeEach: currentBeforeEach, afterEach: currentAfterEach };
        currentBeforeEach = beforeEach;
        currentAfterEach = afterEach;
        fn({ beforeEach: (cb: HookFn) => beforeEach.push(cb), afterEach: (cb: HookFn) => afterEach.push(cb) });
        currentBeforeEach = prev.beforeEach;
        currentAfterEach = prev.afterEach;
      };

      (QUnit as any).test = (
        name: string,
        fn: (assert: Assert) => Promise<void> | void,
      ) => {
        registeredTests.push({ name, fn, beforeEach: [...currentBeforeEach], afterEach: [...currentAfterEach] });
      };

      // Append nonce as a cache-buster so the loader re-evaluates the module
      // on every run. Without this, a cached module (from a prior realm index
      // or a previous run) would skip top-level test() registration calls.
      let bust = new URL(moduleUrl);
      bust.searchParams.set('_t', model.nonce);
      await this.loaderService.loader.import(bust.toString());

      // Apply optional filter: run only the test whose name matches exactly.
      let testsToRun = filter
        ? registeredTests.filter((t) => t.name === filter)
        : registeredTests;

      // Run collected tests sequentially
      let runStart = Date.now();
      let testResults: TestResult[] = [];

      for (let { name, fn, beforeEach, afterEach } of testsToRun) {
        await clearRender();
        let testStart = Date.now();
        let failures: string[] = [];
        let assert: Assert = Object.create(QUnit.assert);
        (assert as any).dom = (
          selector: string | Element,
          container: Element | Document = document,
        ) => {
          let el =
            typeof selector === 'string'
              ? container.querySelector(selector)
              : selector;
          return {
            exists(msg?: string) {
              assert.ok(el !== null, msg ?? `${selector} exists in DOM`);
              return this;
            },
            doesNotExist(msg?: string) {
              assert.ok(el === null, msg ?? `${selector} does not exist in DOM`);
              return this;
            },
            hasText(expected: string, msg?: string) {
              assert.strictEqual(
                el?.textContent?.trim(),
                expected,
                msg ?? `${selector} has text "${expected}"`,
              );
              return this;
            },
            hasTagName(tag: string, msg?: string) {
              assert.strictEqual(
                el?.tagName?.toLowerCase(),
                tag.toLowerCase(),
                msg ?? `${selector} has tag name "${tag}"`,
              );
              return this;
            },
          };
        };
        assert.pushResult = (result: {
          result: boolean;
          actual: unknown;
          expected: unknown;
          message: string;
        }) => {
          if (!result.result) {
            let msg = result.message || '';
            if (result.expected !== undefined) {
              msg += ` — expected: ${JSON.stringify(result.expected)}, actual: ${JSON.stringify(result.actual)}`;
            }
            failures.push(msg.trim());
          }
        };
        try {
          for (let hook of beforeEach) await hook();
          await fn(assert);
        } catch (e: unknown) {
          testResults.push({
            name,
            status: 'fail',
            duration: Date.now() - testStart,
            error: {
              message: e instanceof Error ? e.message : String(e),
              stack: e instanceof Error ? e.stack : undefined,
            },
          });
          continue;
        } finally {
          for (let hook of afterEach) {
            try { await hook(); } catch { /* ignore afterEach errors */ }
          }
        }
        if (failures.length > 0) {
          testResults.push({
            name,
            status: 'fail',
            duration: Date.now() - testStart,
            error: { message: failures.join('\n') },
          });
        } else {
          testResults.push({
            name,
            status: 'pass',
            duration: Date.now() - testStart,
          });
        }
      }

      let passed = testResults.filter((t) => t.status === 'pass').length;
      let failed = testResults.filter((t) => t.status !== 'pass').length;

      model.results = {
        status: failed > 0 ? 'fail' : 'pass',
        total: testResults.length,
        passed,
        failed,
        duration: Date.now() - runStart,
        tests: testResults,
      };
      model.status = 'ready';
    } catch (e: unknown) {
      model.errorMessage =
        e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      model.status = 'error';
    } finally {
      (QUnit as any).test = originalQUnitTest;
      (QUnit as any).module = originalQUnitModule;
      // Rendering context is kept alive until deactivate() so the last
      // rendered card stays visible next to the test results.
    }
  }
}
