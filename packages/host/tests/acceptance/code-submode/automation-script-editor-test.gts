import { click, settled, waitFor, waitUntil } from '@ember/test-helpers';

import { module, test } from 'qunit';

import { baseRealm, rri, type Realm } from '@cardstack/runtime-common';

import {
  setupLocalIndexing,
  setupOnSave,
  setupRealmCacheTeardown,
  testRealmURL,
  getMonacoContent,
  setMonacoContent,
  setupAcceptanceTestRealm,
  SYSTEM_CARD_FIXTURE_CONTENTS,
  visitOperatorMode,
  setupAuthEndpoints,
  setupUserSubscription,
  type TestContextWithSave,
} from '../../helpers';
import { setupCatalogTestSubset } from '../../helpers/catalog-test-subset';
import {
  codeEditorContent,
  typeInCodeEditor,
  waitForCodeEditor,
} from '../../helpers/code-editor';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupApplicationTest } from '../../helpers/setup';

import type { TestRealmAdapter } from '../../helpers/adapter';

const SCRIPT_EDITOR = '[data-test-automation-script-editor]';
const SCRIPT = `const { cards } = await realm.cards.search({});\n`;

function automationJSON(name: string) {
  return {
    data: {
      type: 'card',
      attributes: {
        cardInfo: { name },
        triggers: [
          {
            kind: 'cron',
            label: 'nightly',
            expression: '30 2 * * *',
            timeZone: 'America/Chicago',
            untilDate: null,
            untilTime: null,
            count: null,
            date: null,
            time: null,
            webhookPath: null,
            params: [],
          },
        ],
        operations: [],
        caps: {
          callApiCalls: 0,
          responseBytes: 0,
          resolveCalls: 0,
          writes: 1,
          seconds: 60,
          monthlyCredits: 10,
        },
        params: [],
        milestones: [],
        batchedAI: false,
      },
      relationships: {
        script: { links: { self: '../scripts/nightly.js' } },
      },
      meta: {
        adoptsFrom: {
          module: rri('@cardstack/catalog/automation/automation'),
          name: 'Automation',
        },
      },
    },
  };
}

// The Automation card's edit format edits its script in a code editor of its
// own, beside code mode's editor for the card's JSON. Each must change only its
// own file, keep its own focus and keys, and keep working when the other one
// makes the preview re-render.
module(
  'Acceptance | code submode | automation script editor',
  function (hooks) {
    let adapter: TestRealmAdapter;
    let realm: Realm;

    setupApplicationTest(hooks);
    setupCatalogTestSubset(hooks);
    setupLocalIndexing(hooks);
    setupOnSave(hooks);
    setupRealmCacheTeardown(hooks);
    let mockMatrixUtils = setupMockMatrix(hooks, {
      loggedInAs: '@testuser:localhost',
      activeRealms: [baseRealm.url, testRealmURL],
    });

    hooks.beforeEach(async function () {
      mockMatrixUtils.setRealmPermissions({
        [testRealmURL]: ['read', 'write'],
      });
      setupUserSubscription();
      setupAuthEndpoints();
      ({ adapter, realm } = await setupAcceptanceTestRealm({
        mockMatrixUtils,
        contents: {
          ...SYSTEM_CARD_FIXTURE_CONTENTS,
          'scripts/nightly.js': SCRIPT,
          'automations/nightly.json': automationJSON('Nightly import'),
        },
      }));
    });

    async function openEditFormat() {
      await visitOperatorMode({
        submode: 'code',
        codePath: `${testRealmURL}automations/nightly.json`,
      });
      await click('[data-test-format-chooser="edit"]');
      await waitForCodeEditor(SCRIPT_EDITOR);
      await waitUntil(() => codeEditorContent(SCRIPT_EDITOR) === SCRIPT, {
        timeoutMessage: 'the script editor loads the script',
      });
    }

    async function scriptOnDisk() {
      let file = await adapter.openFile('scripts/nightly.js');
      return file?.content as string | undefined;
    }

    test<TestContextWithSave>('each editor changes only its own file', async function (assert) {
      await openEditFormat();
      let json = getMonacoContent();

      await typeInCodeEditor(SCRIPT_EDITOR, '// checked nightly\n');
      assert.strictEqual(
        codeEditorContent(SCRIPT_EDITOR),
        `${SCRIPT}// checked nightly\n`,
        'the script editor takes the typing',
      );
      assert.strictEqual(
        getMonacoContent(),
        json,
        "code mode's editor is untouched by typing in the script editor",
      );
      assert
        .dom('[data-test-automation-script-unsaved]')
        .exists('the unsaved edit shows');
      assert.strictEqual(
        await scriptOnDisk(),
        SCRIPT,
        'nothing reaches the file before Save',
      );

      await click('[data-test-automation-script-save]');
      await waitUntil(
        async () => (await scriptOnDisk()) === `${SCRIPT}// checked nightly\n`,
        { timeoutMessage: 'Save writes the script file' },
      );
      assert
        .dom('[data-test-automation-script-unsaved]')
        .doesNotExist('nothing is left unsaved');
      assert.strictEqual(
        getMonacoContent(),
        json,
        "saving the script leaves code mode's editor on the card's JSON",
      );
    });

    test<TestContextWithSave>('the script editor keeps working when code mode edits the card', async function (assert) {
      await openEditFormat();

      let saved = new Promise<void>((resolve) => {
        this.onSave((url) => {
          if (url.href === `${testRealmURL}automations/nightly`) {
            resolve();
          }
        });
      });
      setMonacoContent(
        JSON.stringify(automationJSON('Nightly import, renamed'), null, 2),
      );
      await saved;
      await waitFor('[data-test-save-idle]');
      await settled();

      await waitForCodeEditor(SCRIPT_EDITOR);
      assert.strictEqual(
        codeEditorContent(SCRIPT_EDITOR),
        SCRIPT,
        'the re-rendered script editor still shows the script',
      );
      assert.strictEqual(
        await scriptOnDisk(),
        SCRIPT,
        "editing the card's JSON leaves the script file alone",
      );

      await typeInCodeEditor(SCRIPT_EDITOR, '// after the rename\n');
      assert.strictEqual(
        codeEditorContent(SCRIPT_EDITOR),
        `${SCRIPT}// after the rename\n`,
        'the script editor still takes typing',
      );
      assert.true(
        getMonacoContent().includes('Nightly import, renamed'),
        "code mode's editor keeps its own edit",
      );
      assert.false(
        getMonacoContent().includes('after the rename'),
        "code mode's editor doesn't receive the script editor's typing",
      );
    });

    test('a change to the script elsewhere reaches the editor unless it has unsaved edits', async function (assert) {
      await openEditFormat();

      let changed = `${SCRIPT}// changed elsewhere\n`;
      await realm.write('scripts/nightly.js', changed);
      await waitUntil(() => codeEditorContent(SCRIPT_EDITOR) === changed, {
        timeoutMessage: 'the editor takes the change made elsewhere',
      });
      assert.strictEqual(codeEditorContent(SCRIPT_EDITOR), changed);

      await typeInCodeEditor(SCRIPT_EDITOR, '// mine\n');
      await realm.write('scripts/nightly.js', `${SCRIPT}// changed again\n`);
      await settled();
      assert.strictEqual(
        codeEditorContent(SCRIPT_EDITOR),
        `${changed}// mine\n`,
        'unsaved edits are not replaced by a change made elsewhere',
      );
      assert
        .dom('[data-test-automation-script-unsaved]')
        .exists('the edits are still unsaved');
    });
  },
);
