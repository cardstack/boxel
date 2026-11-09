import {
  click,
  find,
  findAll,
  focus,
  settled,
  triggerKeyEvent,
  waitUntil,
} from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import { Deferred } from '@cardstack/runtime-common';

import type MatrixService from '@cardstack/host/services/matrix-service';

import {
  setupAcceptanceTestRealm,
  visitOperatorMode,
  realmConfigCardJSON,
} from '../helpers';
import {
  realmURL,
  nameFromTip,
  setupDashboardTest,
} from '../helpers/dashboard';

// Records what is copied instead of writing the clipboard, until restored.
// With `fail` set, a copy is refused, as a browser does without permission.
function stubClipboard() {
  let clipboard = navigator.clipboard;
  let stub = {
    copied: [] as string[],
    fail: false,
    restore() {
      delete (clipboard as { writeText?: unknown }).writeText;
    },
  };
  clipboard.writeText = async (text: string) => {
    if (stub.fail) {
      throw new Error('clipboard refused');
    }
    stub.copied.push(text);
  };
  return stub;
}

module('Acceptance | dashboard agents', function (hooks) {
  let mockMatrixUtils = setupDashboardTest(hooks);

  module('agents section', function (hooks) {
    const PANEL = '[data-test-agent-panel]';

    let clipboard: ReturnType<typeof stubClipboard>;
    hooks.beforeEach(function () {
      clipboard = stubClipboard();
    });
    hooks.afterEach(function () {
      clipboard.restore();
    });

    function pickedAgent() {
      return (
        find(
          '[data-test-agent-picker] input:checked',
        ) as HTMLInputElement | null
      )?.value;
    }

    test('lists every agent, with the stored pick chosen and its setup progress', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      assert.deepEqual(
        findAll('[data-test-agent-picker] input').map(
          (input) => (input as HTMLInputElement).value,
        ),
        ['claude', 'codex', 'boxel'],
      );
      for (let agent of ['claude', 'codex', 'boxel']) {
        assert
          .dom(`[data-test-agent-picker] [data-test-agent-mark="${agent}"]`)
          .exists(`${agent} shows its mark`);
      }
      assert.strictEqual(pickedAgent(), 'codex');
      assert.dom(PANEL).hasAttribute('data-test-agent-panel', 'codex');
      assert.dom('[data-test-agent-panel-title]').hasText('Connect Codex');
      assert
        .dom(`${PANEL} [data-test-agent-mark="codex"]`)
        .exists("the panel shows the picked agent's mark");
      assert
        .dom('[data-test-agent-setup-progress]')
        .includesText('2 of 6 copied');
      assert
        .dom('[data-test-agent-step="2"]')
        .hasAttribute('data-test-agent-step-copied', 'true');
      assert
        .dom('[data-test-agent-step="3"]')
        .hasAttribute('data-test-agent-step-copied', 'false');
      assert
        .dom('[data-test-agent-step="3"] [data-test-agent-step-text]')
        .hasText('/plugins');
    });

    test('each coding agent lists its own setup, then the workspace steps', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      function stepTexts(count: number) {
        let texts = [];
        for (let step = 1; step <= count; step++) {
          texts.push(
            find(
              `[data-test-agent-step="${step}"] [data-test-agent-step-text]`,
            )?.textContent?.trim(),
          );
        }
        return texts;
      }

      assert.dom('[data-test-agent-step]').exists({ count: 6 });
      assert.deepEqual(stepTexts(4), [
        'npm install -g @cardstack/boxel-cli',
        'codex plugin marketplace add cardstack/boxel',
        '/plugins',
        `Work on my Boxel workspace ${realmURL}`,
      ]);

      await click('[data-test-agent-picker] input[value="claude"]');

      assert.dom('[data-test-agent-step]').exists({ count: 6 });
      assert.deepEqual(stepTexts(4), [
        'npm install -g @cardstack/boxel-cli',
        '/plugin marketplace add cardstack/boxel',
        '/plugin install boxel-cli@cardstack-boxel',
        `Work on my Boxel workspace ${realmURL}`,
      ]);
    });

    test('a stored pick that is no longer listed falls back to the first agent', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      await mockMatrixUtils.setDashboardStateFromAnotherDevice({
        agent: 'grok',
        agentSetup: { grok: 1, claude: 1 },
      });
      await settled();

      assert.strictEqual(pickedAgent(), 'claude');
      assert.dom(PANEL).hasAttribute('data-test-agent-panel', 'claude');
      assert
        .dom('[data-test-agent-setup-progress]')
        .includesText('1 of 6 copied');
    });

    test('progress kept only for an agent no longer listed leaves the section minimized', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      await mockMatrixUtils.setDashboardStateFromAnotherDevice({
        agent: 'grok',
        agentSetup: { grok: 1 },
      });
      await settled();

      assert.dom('[data-test-agent-picker]').doesNotExist();
      assert.dom(PANEL).hasAttribute('data-test-agent-panel', 'boxel');
    });

    test('until a coding agent is taken up, the section shows only Boxel AI Assistant and a way to the others', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      await mockMatrixUtils.setDashboardStateFromAnotherDevice({});
      await settled();

      assert.dom('[data-test-agent-picker]').doesNotExist();
      assert.dom(PANEL).hasAttribute('data-test-agent-panel', 'boxel');
      assert.dom('[data-test-agent-describe-it]').exists();
      assert
        .dom('[data-test-agents-show-coding]')
        .hasText('Use Claude Code or Codex?');
    });

    test('opening the coding agents shows the first one, and copying its step takes it up', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });
      await mockMatrixUtils.setDashboardStateFromAnotherDevice({});
      await settled();

      await click('[data-test-agents-show-coding]');

      assert.dom('[data-test-agents-show-coding]').doesNotExist();
      assert
        .dom('[data-test-agent-picker] input:checked')
        .isFocused('focus moves to the picked agent in what it opened');
      assert.strictEqual(pickedAgent(), 'claude');
      assert.dom(PANEL).hasAttribute('data-test-agent-panel', 'claude');
      let matrixService = getService('matrix-service') as MatrixService;
      assert.strictEqual(
        matrixService.dashboardState.agent,
        undefined,
        'opening the section picks nothing',
      );

      await click('[data-test-agent-copy="1"]');

      assert.deepEqual(clipboard.copied, [
        'npm install -g @cardstack/boxel-cli',
      ]);
      assert.strictEqual(matrixService.dashboardState.agent, 'claude');
      assert.strictEqual(matrixService.dashboardState.agentSetup?.claude, 1);
    });

    test('a copied step keeps the full section, whichever agent is picked', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      await mockMatrixUtils.setDashboardStateFromAnotherDevice({
        agent: 'boxel',
        agentSetup: { codex: 1 },
      });
      await settled();

      assert.dom('[data-test-agents-show-coding]').doesNotExist();
      assert.dom('[data-test-agent-picker]').exists();
      assert.strictEqual(pickedAgent(), 'boxel');
    });

    test('the workspace pick offers only workspaces the user can write to', async function (assert) {
      const sharedRealmURL = 'http://test-realm/testuser/shared-read-only/';
      await setupAcceptanceTestRealm({
        realmURL: sharedRealmURL,
        mockMatrixUtils,
        permissions: { '@testuser:localhost': ['read'] },
        contents: {
          'realm.json': realmConfigCardJSON({ name: 'Shared Workspace' }),
        },
      });
      mockMatrixUtils.setActiveRealms([sharedRealmURL, realmURL]);
      await visitOperatorMode({ workspaceChooserOpened: true });

      let realmServer = getService('realm-server') as any;
      assert.true(
        realmServer.userRealmIdentifiers.includes(sharedRealmURL),
        "the shared workspace is one of the user's workspaces",
      );

      await click(
        '[data-test-agent-workspace-pick] [data-test-pretui-select-trigger]',
      );

      assert.deepEqual(
        findAll("[role='listbox'] [data-test-pretui-select-option]").map((el) =>
          el.textContent?.trim(),
        ),
        ['Workspace A'],
      );
    });

    test('the workspace step names the workspace', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      assert
        .dom('[data-test-agent-step="4"] [data-test-agent-step-text]')
        .hasText(
          `Work on my Boxel workspace ${realmURL}`,
          'the workspace is filled in',
        );
    });

    test('picking an agent saves it and shows its own setup', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      await click('[data-test-agent-picker] input[value="claude"]');

      let matrixService = getService('matrix-service') as MatrixService;
      assert.strictEqual(matrixService.dashboardState.agent, 'claude');
      assert.strictEqual(pickedAgent(), 'claude');
      assert
        .dom('[data-test-agent-setup-progress]')
        .includesText('0 of 6 copied', 'progress is kept per agent');
      assert
        .dom('[data-test-agent-step="1"] [data-test-agent-step-text]')
        .hasText('npm install -g @cardstack/boxel-cli');
    });

    test('copying a step puts its text on the clipboard and counts it', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      assert.strictEqual(
        nameFromTip('[data-test-agent-copy="3"]'),
        'Copy',
        'its tip names it',
      );
      assert.true(
        (
          find('[data-test-agent-copy="3"]')?.getAttribute(
            'aria-describedby',
          ) ?? ''
        )
          .split(' ')
          .includes(
            find('[data-test-agent-step="3"] [data-test-agent-step-text]')
              ?.id ?? '-',
          ),
        'the text it copies describes it',
      );

      await click('[data-test-agent-copy="3"]');

      assert.deepEqual(clipboard.copied, ['/plugins']);
      let matrixService = getService('matrix-service') as MatrixService;
      assert.deepEqual(matrixService.dashboardState.agentSetup, {
        codex: 3,
      });
      assert
        .dom('[data-test-agent-setup-progress]')
        .includesText('3 of 6 copied');
      assert
        .dom('[data-test-agent-step="3"]')
        .hasAttribute('data-test-agent-step-copied', 'true');
    });

    test('copying an earlier step again does not lower the count', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      await click('[data-test-agent-copy="1"]');

      let matrixService = getService('matrix-service') as MatrixService;
      assert.strictEqual(matrixService.dashboardState.agentSetup?.codex, 2);
    });

    test('a copy the browser refuses is not counted', async function (assert) {
      clipboard.fail = true;
      await visitOperatorMode({ workspaceChooserOpened: true });

      // Not awaited: settling waits out the feedback, which clears the
      // announcement.
      click('[data-test-agent-copy="3"]');
      await waitUntil(() =>
        find('[data-test-agent-copy-status]')?.textContent?.trim(),
      );
      assert
        .dom('[data-test-agent-copy-status]')
        .hasText('Step 3 copy failed', 'the refusal is announced');
      await settled();

      let matrixService = getService('matrix-service') as MatrixService;
      assert.strictEqual(matrixService.dashboardState.agentSetup?.codex, 2);
      assert
        .dom('[data-test-agent-setup-progress]')
        .includesText('2 of 6 copied');
      assert
        .dom('[data-test-agent-step="3"]')
        .hasAttribute('data-test-agent-step-copied', 'false');
    });

    test('a finished setup folds its steps away behind Show steps', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      await mockMatrixUtils.setDashboardStateFromAnotherDevice({
        agent: 'codex',
        agentSetup: { codex: 6 },
      });
      await settled();

      assert
        .dom('[data-test-agent-setup-progress]')
        .includesText('6 of 6 copied');
      assert.dom('[data-test-agent-step]').doesNotExist();
      assert
        .dom('[data-test-agent-steps-toggle]')
        .hasText('Show steps')
        .hasAttribute('aria-expanded', 'false');

      await click('[data-test-agent-steps-toggle]');

      assert.dom('[data-test-agent-step]').exists({ count: 6 });
      assert
        .dom('[data-test-agent-steps-toggle]')
        .hasText('Hide steps')
        .hasAttribute('aria-expanded', 'true');
    });

    test('copying the last step keeps the steps in view', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      await mockMatrixUtils.setDashboardStateFromAnotherDevice({
        agent: 'codex',
        agentSetup: { codex: 5 },
      });
      await settled();

      await click('[data-test-agent-copy="6"]');

      assert
        .dom('[data-test-agent-setup-progress]')
        .includesText('6 of 6 copied');
      assert.dom('[data-test-agent-step]').exists({ count: 6 });
      assert.dom('[data-test-agent-steps-toggle]').hasText('Hide steps');
    });

    test('Boxel AI Assistant shows how it works, and Describe it starts a session', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      await click('[data-test-agent-picker] input[value="boxel"]');

      assert.dom(PANEL).hasAttribute('data-test-agent-panel', 'boxel');
      assert
        .dom('[data-test-agent-panel-title]')
        .hasText('Build with Boxel AI Assistant');
      assert.dom('[data-test-agent-setup-progress]').doesNotExist();
      assert.dom(PANEL).includesText('Uses credits');

      await click('[data-test-agent-describe-it]');

      assert.dom('[data-test-ai-assistant-panel]').exists();
    });
  });

  module('rail entry', function () {
    const ENTRY = '[data-test-section-rail-entry="agents"]';
    const FLYOUT = '[data-test-section-rail-flyout="agents"]';

    test('the flyout lists the agents, and picking one saves it and shows the Agents section', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      await focus(ENTRY);
      await triggerKeyEvent(ENTRY, 'keydown', 'Enter');
      await click(ENTRY);

      assert.dom(FLYOUT).exists();
      assert.deepEqual(
        findAll(`${FLYOUT} [data-test-section-rail-agent]`).map((el) =>
          el.getAttribute('data-test-section-rail-agent'),
        ),
        ['claude', 'codex', 'boxel'],
      );
      for (let agent of ['claude', 'codex', 'boxel']) {
        assert
          .dom(
            `${FLYOUT} [data-test-section-rail-agent="${agent}"] [data-test-agent-mark="${agent}"]`,
          )
          .exists(`${agent} shows its mark`);
      }
      assert
        .dom(`${FLYOUT} [data-test-section-rail-agent="codex"]`)
        .includesText('(picked)');
      assert.dom(`${FLYOUT} [data-test-section-rail-ai-new-session]`).exists();

      await click(`${FLYOUT} [data-test-section-rail-agent="claude"]`);

      assert.dom(FLYOUT).doesNotExist('a pick closes the flyout');
      assert.dom(ENTRY).isFocused('focus goes back to the entry');
      let matrixService = getService('matrix-service') as MatrixService;
      assert.strictEqual(matrixService.dashboardState.agent, 'claude');
      assert
        .dom('[data-test-agent-panel]')
        .hasAttribute('data-test-agent-panel', 'claude');
      assert.dom(ENTRY).hasAttribute('aria-current', 'location');
    });

    test('a pick from the flyout shows in the Agents section before its save lands', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      let matrixService = getService('matrix-service') as MatrixService;
      let update = matrixService.updateDashboardState;
      let save = new Deferred<void>();
      matrixService.updateDashboardState = async (change) => {
        await save.promise;
        return update.call(matrixService, change);
      };
      try {
        await click(ENTRY);
        await click(`${FLYOUT} [data-test-section-rail-agent="claude"]`);

        assert.strictEqual(
          matrixService.dashboardState.agent,
          'codex',
          'the save has not landed',
        );
        assert
          .dom('[data-test-agent-panel]')
          .hasAttribute('data-test-agent-panel', 'claude');
      } finally {
        matrixService.updateDashboardState = update;
        save.fulfill();
      }
      await settled();

      assert.strictEqual(matrixService.dashboardState.agent, 'claude');
      assert
        .dom('[data-test-agent-panel]')
        .hasAttribute('data-test-agent-panel', 'claude');
    });

    test('for a user with no coding agent, the flyout marks Boxel AI Assistant as picked, as the section shows', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });
      await mockMatrixUtils.setDashboardStateFromAnotherDevice({});
      await settled();

      await click(ENTRY);

      assert
        .dom(`${FLYOUT} [data-test-section-rail-agent="boxel"]`)
        .includesText('(picked)');
      assert
        .dom(`${FLYOUT} [data-test-section-rail-agent="claude"]`)
        .doesNotIncludeText('(picked)');
      assert
        .dom('[data-test-agent-panel]')
        .hasAttribute('data-test-agent-panel', 'boxel');
    });

    test('a pick from the flyout replaces the agent the section opened on', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });
      await mockMatrixUtils.setDashboardStateFromAnotherDevice({});
      await settled();
      await click('[data-test-agents-show-coding]');
      assert
        .dom('[data-test-agent-panel]')
        .hasAttribute('data-test-agent-panel', 'claude');

      await click(ENTRY);
      await click(`${FLYOUT} [data-test-section-rail-agent="codex"]`);

      assert
        .dom('[data-test-agent-panel]')
        .hasAttribute('data-test-agent-panel', 'codex');
    });

    test('New session in the flyout opens Boxel AI Assistant', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });

      await click(ENTRY);
      await click(`${FLYOUT} [data-test-section-rail-ai-new-session]`);

      assert.dom(FLYOUT).doesNotExist();
      assert.dom(ENTRY).isFocused('focus goes back to the entry');
      assert.dom('[data-test-ai-assistant-panel]').exists();
    });

    // Agents sits too near the page's end to reach the top, so the jump
    // must not hand the rest of the scroll to the ancestors around the
    // dashboard, which have no way back.
    test('jumping to Agents scrolls only the dashboard', async function (assert) {
      await visitOperatorMode({ workspaceChooserOpened: true });
      let scroller = find('[data-test-dashboard-scroller]') as HTMLElement;

      await click(ENTRY);
      // The jump is a smooth scroll: wait for it to start and come to rest.
      let last = -1;
      let restingPolls = 0;
      await waitUntil(
        () => {
          let top = scroller.scrollTop;
          restingPolls = top === last ? restingPolls + 1 : 0;
          last = top;
          return top > 0 && restingPolls >= 10;
        },
        { timeout: 3000 },
      );

      let scrolledAncestors: Element[] = [];
      for (let el = scroller.parentElement; el; el = el.parentElement) {
        if (el.scrollTop !== 0) {
          scrolledAncestors.push(el);
        }
      }
      assert.strictEqual(
        scrolledAncestors.length,
        0,
        'no ancestor of the dashboard is scrolled',
      );
      assert.dom(ENTRY).hasAttribute('aria-current', 'location');
    });
  });
});
