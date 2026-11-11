import {
  click,
  fillIn,
  triggerKeyEvent,
  waitFor,
  waitUntil,
} from '@ember/test-helpers';

import { module, test } from 'qunit';

import { baseRealm, rri } from '@cardstack/runtime-common';

import {
  setupLocalIndexing,
  setupOnSave,
  setupRealmCacheTeardown,
  testRealmURL,
  setupAcceptanceTestRealm,
  SYSTEM_CARD_FIXTURE_CONTENTS,
  visitOperatorMode,
  setupAuthEndpoints,
  setupUserSubscription,
} from '../helpers';
import { setupCatalogTestSubset } from '../helpers/catalog-test-subset';
import {
  codeEditorContent,
  typeInCodeEditor,
  waitForCodeEditor,
} from '../helpers/code-editor';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupApplicationTest } from '../helpers/setup';

import type { TestRealmAdapter } from '../helpers/adapter';

const SCRIPT = `const { cards } = await realm.cards.search({});\n`;
const SCRIPT_EDITOR = '[data-test-automation-script-editor]';

function trigger(kind: string, extra: Record<string, unknown> = {}) {
  return {
    kind,
    label: null,
    expression: null,
    timeZone: 'America/Chicago',
    untilDate: null,
    untilTime: null,
    count: null,
    date: null,
    time: null,
    webhookPath: null,
    params: [],
    ...extra,
  };
}

function automationJSON(
  name: string,
  { script = '../scripts/nightly.js' }: { script?: string | null } = {},
) {
  return {
    data: {
      type: 'card',
      attributes: {
        cardInfo: { name, summary: null },
        triggers: [
          trigger('cron', {
            label: 'nightly',
            expression: '30 2 * * *',
            untilDate: '2030-01-15',
          }),
          trigger('once', {
            label: 'kickoff',
            date: '2030-06-10',
            time: '09:00',
          }),
        ],
        operations: [],
        caps: {
          callApiCalls: 0,
          responseBytes: 0,
          resolveCalls: 0,
          writes: 1,
          seconds: 60,
          dailyCredits: 5,
          monthlyCredits: 10,
        },
        params: [],
        batchedAI: false,
        batchDeadlineMinutes: null,
      },
      relationships: {
        script: { links: { self: script } },
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

const TRACKER = `
  import { CardDef, contains, field } from '@cardstack/base/card-api';
  import StringField from '@cardstack/base/string';
  import { instance, operation } from '@cardstack/base/operations';
  export class Tracker extends CardDef {
    static displayName = 'Tracker';
    @field project = contains(StringField);
    @operation static openTickets = {
      base: 'callApi',
      label: 'List the project’s open tickets',
      url: 'https://tracker.example/projects/{project}/tickets',
      path: { project: instance('project') },
    };
  }
`;

// The Pret UI Field whose label reads `label`, inside `scope`.
function field(label: string, scope: ParentNode = document): HTMLElement {
  let match = [...scope.querySelectorAll('[data-test-pretui-field]')].find(
    (element) =>
      element
        .querySelector('[data-test-pretui-field-label]')
        ?.textContent?.trim() === label,
  );
  if (!match) {
    throw new Error(`no field labelled "${label}"`);
  }
  return match as HTMLElement;
}

function inputOf(label: string, scope: ParentNode = document) {
  let input = field(label, scope).querySelector('input');
  if (!input) {
    throw new Error(`the field labelled "${label}" has no input`);
  }
  return input;
}

function messageOf(label: string, scope: ParentNode = document) {
  return (
    field(label, scope)
      .querySelector('[data-test-pretui-field-message]')
      ?.textContent?.trim() ?? ''
  );
}

// A section of the edit format, by its title: a Pret UI FormSection, or a
// Fieldset by its legend. A FormSection's legend holds its issue badge and
// actions after the title, so only the legend's first element is read: the
// title itself, or the toggle that holds it when the section collapses.
function section(title: string): HTMLElement {
  let match = [
    ...document.querySelectorAll<HTMLElement>(
      '[data-test-pretui-form-section], [data-test-pretui-fieldset]',
    ),
  ].find((element) => {
    let heading = element.hasAttribute('data-test-pretui-form-section')
      ? element.querySelector(
          ':scope > legend [data-test-pretui-form-section-title]',
        )
      : element.querySelector(':scope > legend');
    return heading?.textContent?.trim() === title;
  });
  if (!match) {
    throw new Error(`no section titled "${title}"`);
  }
  return match;
}

function triggerItem(index: number): HTMLElement {
  let item = document.querySelector(
    `[data-test-automation-trigger="${index}"]`,
  );
  if (!item) {
    throw new Error(`no trigger ${index}`);
  }
  return item as HTMLElement;
}

// Enters a time the way a person does: a click on the time box, away from
// its digits, then the digits typed one after another. Each must land in the
// box, which keeps focus as it moves from the hour to the minute.
async function typeTime(scope: HTMLElement, digits: string) {
  let box = scope.querySelector('[data-test-pretui-time-input]') as HTMLElement;
  await click(box);
  for (let digit of digits) {
    let segment = document.activeElement as HTMLElement;
    if (!segment?.hasAttribute('data-segment')) {
      throw new Error(`the time box lost focus before ${digit} was typed`);
    }
    await triggerKeyEvent(segment, 'keydown', digit);
  }
}

// Searches the time zone picker in `scope` and picks the zone named `zone`.
// Inside the Pret UI Combobox, ember-power-select renders the trigger, its
// search input and the options, so they're found by that library's own
// attributes and roles: the `data-ebd-id` its dropdown trigger carries, the
// one `input`, and the `option` role. The options render in place, inside
// the combobox.
async function pickTimeZone(scope: ParentNode, search: string, zone: string) {
  let combobox = field('Time zone', scope).querySelector(
    '[data-test-pretui-combobox]',
  );
  if (!combobox) {
    throw new Error('the time zone field has no combobox');
  }
  await click(combobox.querySelector('[data-ebd-id$="-trigger"]')!);
  await fillIn(combobox.querySelector('input')!, search);
  let option = [...combobox.querySelectorAll('[role="option"]')].find((o) =>
    o.textContent?.includes(zone),
  );
  if (!option) {
    throw new Error(`no time zone option reading ${zone}`);
  }
  await click(option as HTMLElement);
}

function buttonIn(scope: ParentNode, text: string): HTMLElement {
  let match = [...scope.querySelectorAll('button')].find(
    (button) => button.textContent?.trim() === text,
  );
  if (!match) {
    throw new Error(`no button reading "${text}"`);
  }
  return match;
}

module('Acceptance | automation edit format', function (hooks) {
  let adapter: TestRealmAdapter;

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
    ({ adapter } = await setupAcceptanceTestRealm({
      mockMatrixUtils,
      contents: {
        ...SYSTEM_CARD_FIXTURE_CONTENTS,
        'scripts/nightly.js': SCRIPT,
        'other-script.js': `// another script\n`,
        'tracker.gts': TRACKER,
        'trackers/main.json': {
          data: {
            type: 'card',
            attributes: { cardInfo: { name: 'Main tracker' }, project: 'main' },
            meta: { adoptsFrom: { module: '../tracker', name: 'Tracker' } },
          },
        },
        'automations/nightly.json': automationJSON('Nightly import'),
        'automations/unscripted.json': automationJSON('Unscripted', {
          script: null,
        }),
        // No script, one run on a date, and batched AI on: what the fitted
        // view flags.
        'automations/batched.json': (() => {
          let json = automationJSON('Batched', { script: null });
          let attributes = json.data.attributes as Record<string, any>;
          attributes.triggers = [attributes.triggers[1]];
          attributes.caps = { ...attributes.caps, resolveCalls: 5 };
          attributes.batchedAI = true;
          return json;
        })(),
        'automations/fresh.json': (() => {
          let json = automationJSON('Fresh');
          (json.data.attributes as Record<string, unknown>).caps = {};
          return json;
        })(),
      },
    }));
  });

  async function openEdit(name = 'nightly') {
    await visitOperatorMode({
      stacks: [[{ id: `${testRealmURL}automations/${name}`, format: 'edit' }]],
    });
    await waitFor('[data-test-automation-add-trigger]');
  }

  async function saved(name = 'nightly') {
    let file = await adapter.openFile(`automations/${name}.json`);
    return JSON.parse(file!.content as string).data;
  }

  // Waits until the saved card satisfies `check`, so each assertion reads
  // what reached the realm, not what the page shows.
  async function waitForSave(
    check: (data: any) => boolean,
    message: string,
    name = 'nightly',
  ) {
    await waitUntil(
      async () => {
        try {
          return check(await saved(name));
        } catch {
          return false;
        }
      },
      { timeout: 10000, timeoutMessage: message },
    );
  }

  test('the name and summary are saved', async function (assert) {
    await openEdit();
    await fillIn('[data-test-field="name"] input', 'Nightly sync');
    await fillIn(
      '[data-test-field="summary"] input',
      'Pulls the night’s changes',
    );
    await waitForSave(
      (d) =>
        d.attributes.cardInfo.name === 'Nightly sync' &&
        d.attributes.cardInfo.summary === 'Pulls the night’s changes',
      'the name and summary are saved',
    );
    assert.ok(true);
  });

  test('the script editor discards unsaved edits', async function (assert) {
    await openEdit();
    await waitForCodeEditor(SCRIPT_EDITOR);
    await waitUntil(() => codeEditorContent(SCRIPT_EDITOR) === SCRIPT);

    await typeInCodeEditor(SCRIPT_EDITOR, '// not wanted\n');
    assert.dom('[data-test-automation-script-unsaved]').exists();
    await click('[data-test-automation-script-discard]');
    assert.strictEqual(
      codeEditorContent(SCRIPT_EDITOR),
      SCRIPT,
      'Discard puts back the saved script',
    );
    assert.dom('[data-test-automation-script-unsaved]').doesNotExist();
    let file = await adapter.openFile('scripts/nightly.js');
    assert.strictEqual(file?.content, SCRIPT, 'the file is untouched');
  });

  test('a card with no script creates one with New script', async function (assert) {
    await openEdit('unscripted');
    assert.dom('[data-test-automation-link-script]').hasText('Link a file');
    await click('[data-test-automation-new-script]');

    let name = '[data-test-automation-new-script-name] input';
    assert
      .dom(name)
      .hasValue('scripts/unscripted', 'the name starts from the card’s name');

    await fillIn(name, 'scripts/not ok');
    assert
      .dom('[data-test-automation-new-script-create]')
      .isDisabled('an invalid name can’t be created');
    assert
      .dom('dialog[open]')
      .includesText('Use letters, numbers, dashes and underscores');

    await fillIn(name, 'scripts/nightly');
    await click('[data-test-automation-new-script-create]');
    await waitFor('[data-test-automation-new-script-failure]');
    assert
      .dom('[data-test-automation-new-script-failure]')
      .includesText(
        'A file with that name already exists',
        'an existing file is never overwritten',
      );

    await fillIn(name, 'scripts/unscripted');
    await click('[data-test-automation-new-script-create]');
    await waitForSave(
      (d) =>
        String(d.relationships.script.links.self).endsWith(
          'scripts/unscripted.js',
        ),
      'the new script is linked to the card',
      'unscripted',
    );
    let file = await adapter.openFile('scripts/unscripted.js');
    assert.ok(
      String(file?.content).includes('await realm.activity('),
      'the new script starts from the outline',
    );
    await waitForCodeEditor(SCRIPT_EDITOR);
    assert.ok(
      codeEditorContent(SCRIPT_EDITOR).includes('Realm Runner script'),
      'the new script opens in the editor',
    );
  });

  test('a card with no script links one with Link a file', async function (assert) {
    await openEdit('unscripted');
    await click('[data-test-automation-link-script]');
    await waitFor('[data-test-choose-file-modal]');
    await click('[data-test-file="other-script.js"]');
    await click('[data-test-choose-file-modal-add-button]');
    await waitForSave(
      (d) =>
        String(d.relationships.script.links.self).endsWith('other-script.js'),
      'the chosen file is linked to the card',
      'unscripted',
    );
    assert.ok(true);
  });

  test('a schedule trigger saves each of its fields', async function (assert) {
    await openEdit();
    let item = triggerItem(0);

    await fillIn(inputOf('Label', item), 'every-night');
    await fillIn(inputOf('Cron expression', item), '* * * * *');
    assert.strictEqual(
      messageOf('Cron expression', item),
      'It can run at most once every 5 minutes',
      'a schedule more often than every 5 minutes is refused',
    );
    await fillIn(inputOf('Cron expression', item), 'not cron');
    assert.ok(
      messageOf('Cron expression', item).startsWith(
        'A cron expression has five fields',
      ),
      'a malformed expression is explained',
    );

    await click(buttonIn(item, 'How to write a schedule'));
    let dialog = document.querySelector('dialog[open]') as HTMLElement;
    assert.ok(
      dialog.textContent?.includes('Day of the week'),
      'the help names each position',
    );
    await click(buttonIn(dialog, 'Use this'));
    assert.strictEqual(
      inputOf('Cron expression', item).value,
      '0 7 * * MON',
      'Use this fills in the expression',
    );
    assert.dom(item).includesText('Every Monday at 7:00 AM');

    await pickTimeZone(item, 'Tokyo', 'Asia/Tokyo');

    await fillIn(inputOf('Number of runs', item), '52');

    await click(inputOf('Last day', item));
    let day = [
      ...document.querySelectorAll(
        '[data-test-pretui-calendar] button[aria-pressed]:not([data-outside])',
      ),
    ].find((d) => d.textContent?.trim() === '25') as HTMLElement;
    await click(day);

    let timeField = field('Time on the last day', item);
    await typeTime(timeField, '1745');

    await waitForSave((d) => {
      let t = d.attributes.triggers[0];
      return (
        t.label === 'every-night' &&
        t.expression === '0 7 * * MON' &&
        t.timeZone === 'Asia/Tokyo' &&
        t.count === 52 &&
        t.untilDate === '2030-01-25' &&
        t.untilTime === '17:45'
      );
    }, 'the schedule trigger’s label, expression, time zone, count, last day and time are saved');

    // The time's segments take the keyboard too.
    // A click on the hour itself focuses it, and the arrow keys step it.
    let hour = timeField.querySelector('[data-segment]') as HTMLElement;
    await click(hour);
    assert.strictEqual(
      document.activeElement,
      hour,
      'a click on the hour focuses it',
    );
    assert.strictEqual(
      getComputedStyle(hour).cursor,
      'pointer',
      'the hour shows a pointer',
    );
    assert.notStrictEqual(
      getComputedStyle(hour).backgroundColor,
      'rgba(0, 0, 0, 0)',
      'and is highlighted once clicked, so the click shows',
    );
    await triggerKeyEvent(hour, 'keydown', 'ArrowUp');
    await waitForSave(
      (d) => d.attributes.triggers[0].untilTime === '18:45',
      'stepping the hour with the arrow keys is saved',
    );
    assert.ok(true);
  });

  test('a one-time trigger saves its date, time and time zone', async function (assert) {
    await openEdit();
    let item = triggerItem(1);

    await click(inputOf('Date', item));
    let day = [
      ...document.querySelectorAll(
        '[data-test-pretui-calendar] button[aria-pressed]:not([data-outside])',
      ),
    ].find((d) => d.textContent?.trim() === '20') as HTMLElement;
    await click(day);

    await typeTime(field('Time', item), '1430');

    await pickTimeZone(item, 'London', 'Europe/London');

    await waitForSave((d) => {
      let t = d.attributes.triggers[1];
      return (
        t.date === '2030-06-20' &&
        t.time === '14:30' &&
        t.timeZone === 'Europe/London'
      );
    }, 'the one-time trigger’s date, time and time zone are saved');
    assert.ok(true);
  });

  test('a trigger changes kind, takes a webhook path, and carries its own params', async function (assert) {
    await openEdit();
    let item = triggerItem(0);

    await click(item.querySelector('input[type="radio"][value="webhook"]')!);
    await fillIn(inputOf('Webhook path', item), 'stripe-events');
    await waitForSave(
      (d) =>
        d.attributes.triggers[0].kind === 'webhook' &&
        d.attributes.triggers[0].webhookPath === 'stripe-events',
      'the webhook kind and path are saved',
    );

    let params = section('Params for this trigger');
    await click(buttonIn(params, 'Add a param'));
    await fillIn(
      params.querySelector('input[aria-label="Param name"]')!,
      'fullRefresh',
    );
    await fillIn(
      params.querySelector('input[aria-label="Param value"]')!,
      'true',
    );
    await waitForSave(
      (d) =>
        d.attributes.triggers[0].params.length === 1 &&
        d.attributes.triggers[0].params[0].name === 'fullRefresh' &&
        d.attributes.triggers[0].params[0].value === 'true',
      'the trigger’s param is saved',
    );
    await click(buttonIn(params, 'Remove'));
    await waitForSave(
      (d) => d.attributes.triggers[0].params.length === 0,
      'removing the trigger’s param is saved',
    );

    await click(item.querySelector('input[type="radio"][value="once"]')!);
    assert
      .dom(field('Date', item))
      .exists('a one-time trigger asks for a date');
    await waitForSave(
      (d) => d.attributes.triggers[0].kind === 'once',
      'the kind change is saved',
    );
  });

  test('triggers are added and removed', async function (assert) {
    await openEdit();
    await click('[data-test-automation-add-trigger]');
    await waitForSave(
      (d) => d.attributes.triggers.length === 3,
      'a new trigger is saved',
    );
    assert.strictEqual(
      (await saved()).attributes.triggers[2].kind,
      'cron',
      'a new trigger starts as a schedule',
    );
    await click('[data-test-automation-remove-trigger="2"]');
    await waitForSave(
      (d) => d.attributes.triggers.length === 2,
      'removing a trigger is saved',
    );
  });

  test('two triggers may not share a label', async function (assert) {
    await openEdit();
    assert.dom('[data-test-automation-triggers-problem]').doesNotExist();
    await fillIn(inputOf('Label', triggerItem(1)), 'nightly');
    assert
      .dom('[data-test-automation-triggers-problem]')
      .hasText('Two triggers share the label “nightly”: each needs its own');
    await fillIn(inputOf('Label', triggerItem(1)), 'kickoff');
    assert
      .dom('[data-test-automation-triggers-problem]')
      .doesNotExist('a label of its own clears the problem');
  });

  test('every limit is saved, in the units it is entered in', async function (assert) {
    await openEdit();
    let limits = section('Limits');
    // [label, what is typed, what is saved]
    let values: Record<string, [string, string, number]> = {
      callApiCalls: ['Outside calls', '7', 7],
      responseBytes: ['Data received, in MB', '3', 3_000_000],
      resolveCalls: ['AI requests', '4', 4],
      writes: ['Saves', '12', 12],
      seconds: ['Run time, in minutes', '10', 600],
      dailyCredits: ['Credits a day', '20', 20],
      monthlyCredits: ['Credits a month', '300', 300],
    };
    for (let [label, typed] of Object.values(values)) {
      await fillIn(inputOf(label, limits), typed);
    }
    await waitForSave(
      (d) =>
        Object.entries(values).every(
          ([key, [, , saved]]) => d.attributes.caps[key] === saved,
        ),
      'every limit is saved, run time in seconds and data in bytes',
    );
    for (let label of [
      'Outside calls',
      'Data received, in MB',
      'AI requests',
      'Saves',
      'Run time, in minutes',
    ]) {
      assert
        .dom(
          field(label, limits).querySelector(
            '[data-test-pretui-field-required]',
          ),
        )
        .exists(`${label} is marked required`);
    }
  });

  test('an empty run limit is an error, and one credit limit is enough', async function (assert) {
    await openEdit();
    let limits = section('Limits');

    await fillIn(inputOf('Saves', limits), '');
    assert.strictEqual(
      messageOf('Saves', limits),
      'Required: enter a number, or 0 to forbid this',
      'an empty run limit is required, not unlimited',
    );

    await fillIn(inputOf('Credits a day', limits), '');
    assert.strictEqual(
      messageOf('Credits a day', limits),
      'No daily limit: only the monthly limit applies',
    );
    await waitForSave(
      (d) =>
        d.attributes.caps.dailyCredits === null &&
        d.attributes.caps.monthlyCredits === 10,
      'a card may set only the monthly credit limit',
    );

    await fillIn(inputOf('Credits a month', limits), '');
    assert.strictEqual(
      messageOf('Credits a month', limits),
      'Set a daily or a monthly limit, or both',
      'with neither credit limit set, the card says one is needed',
    );

    await fillIn(inputOf('Credits a day', limits), '30');
    await fillIn(inputOf('Credits a month', limits), '20');
    assert.strictEqual(
      messageOf('Credits a day', limits),
      'Can’t be more than the credits a month.',
    );
  });

  test('a new automation starts with every limit filled in', async function (assert) {
    await openEdit('fresh');
    await waitForSave(
      (d) =>
        JSON.stringify(d.attributes.caps) ===
        JSON.stringify({
          callApiCalls: 10,
          responseBytes: 5_000_000,
          resolveCalls: 5,
          writes: 50,
          seconds: 300,
          dailyCredits: 500,
          monthlyCredits: 10_000,
        }),
      'a card with no limits gets the starting limits',
      'fresh',
    );
    assert.strictEqual(
      inputOf('Run time, in minutes', section('Limits')).value,
      '5',
    );
  });

  test('a trigger marks and checks its required fields', async function (assert) {
    await openEdit();
    let item = triggerItem(0);
    for (let label of ['Label', 'Cron expression', 'Time zone']) {
      assert
        .dom(
          field(label, item).querySelector('[data-test-pretui-field-required]'),
        )
        .exists(`${label} is marked required`);
    }
    await fillIn(inputOf('Label', item), '');
    assert.strictEqual(
      messageOf('Label', item),
      'Required: give this trigger a name',
    );
    await fillIn(inputOf('Cron expression', item), '');
    assert.strictEqual(
      messageOf('Cron expression', item),
      'Required: enter when it runs, such as 0 7 * * MON',
    );

    await click(item.querySelector('input[type="radio"][value="webhook"]')!);
    assert.strictEqual(
      messageOf('Webhook path', item),
      'Required: enter one of this workspace’s incoming webhooks',
    );
  });

  test('batched AI needs AI requests, and saves its deadline', async function (assert) {
    await openEdit();
    let batched = section('Batched AI');
    let toggle = () =>
      batched.querySelector('[role="switch"]') as HTMLButtonElement;

    assert.dom(toggle()).isDisabled('no AI requests, no batched AI');
    assert
      .dom(batched)
      .includesText('This automation may not make AI requests');

    await fillIn(inputOf('AI requests', section('Limits')), '3');
    assert.dom(toggle()).isEnabled();
    assert.dom(batched).doesNotIncludeText('may not make AI requests');

    await click(toggle());
    assert.strictEqual(
      messageOf('Deadline, in minutes', batched),
      'Waits 1 hour when left empty. Up to 1,440 (24 hours).',
    );
    await fillIn(inputOf('Deadline, in minutes', batched), '30');
    assert.strictEqual(
      messageOf('Deadline, in minutes', batched),
      'Under an hour, more answers miss the deadline and cost full price.',
    );
    await fillIn(inputOf('Deadline, in minutes', batched), '90');
    await waitForSave(
      (d) =>
        d.attributes.batchedAI === true &&
        d.attributes.batchDeadlineMinutes === 90,
      'batched AI and its deadline are saved',
    );

    await click(toggle());
    assert
      .dom(batched)
      .doesNotIncludeText('Deadline, in minutes', 'off hides the deadline');
    await waitForSave(
      (d) => d.attributes.batchedAI === false,
      'turning batched AI off is saved',
    );
  });

  test('an outside service is chosen from a card, not typed', async function (assert) {
    await openEdit();
    let services = section('Outside services');
    assert
      .dom(services.querySelector('input'))
      .doesNotExist('nothing about an outside service is typed');

    await click('[data-test-automation-add-service]');
    await waitFor('[data-test-card-chooser-modal]');
    await click(`[data-test-item-button="${testRealmURL}trackers/main"]`);
    await click('[data-test-card-chooser-go-button]');
    await waitFor('[data-test-automation-service-calls]');
    assert
      .dom('dialog[open]')
      .includesText('List the project’s open tickets')
      .includesText('tracker.example', 'each call names the site it reaches')
      .includesText(
        "realm.operations.invoke('trackers/main', 'openTickets', {})",
        'and how the script makes it',
      );
    // Another card can be chosen from the dialog: it steps aside so the
    // chooser can be used, and comes back with the new card.
    await click('[data-test-automation-choose-another-service]');
    await waitFor('[data-test-card-chooser-modal]');
    assert
      .dom('dialog[open] [data-test-automation-service-calls]')
      .doesNotExist('the dialog closes while the chooser is open');
    await click(`[data-test-item-button="${testRealmURL}trackers/main"]`);
    await click('[data-test-card-chooser-go-button]');
    await waitFor('dialog[open] [data-test-automation-service-calls]');
    await click('[data-test-automation-add-service-confirm]');
    await waitForSave(
      (d) =>
        d.attributes.operations.length === 1 &&
        d.attributes.operations[0].targetType?.name === 'Tracker' &&
        d.attributes.operations[0].operation === 'openTickets',
      'the chosen call is saved as its card type and name',
    );

    await click('[data-test-automation-remove-service]');
    await waitForSave(
      (d) => d.attributes.operations.length === 0,
      'removing it is saved',
    );
  });

  test('a card with no outside calls says so', async function (assert) {
    await openEdit();
    await click('[data-test-automation-add-service]');
    await waitFor('[data-test-card-chooser-modal]');
    await click(
      `[data-test-item-button="${testRealmURL}automations/unscripted"]`,
    );
    await click('[data-test-card-chooser-go-button]');
    await waitFor('[data-test-automation-no-calls]');
    assert
      .dom('[data-test-automation-no-calls]')
      .includesText('makes no outside calls');
    assert.dom('[data-test-automation-add-service-confirm]').isDisabled();
  });

  test('params are added, edited and removed', async function (assert) {
    await openEdit();
    await click('[data-test-automation-add-param]');
    assert
      .dom('[data-test-automation-params-problem]')
      .hasText('Every param needs a name');
    let param = document.querySelector(
      '[data-test-automation-param="0"]',
    ) as HTMLElement;
    await fillIn(inputOf('Name', param), 'repository');
    assert.dom('[data-test-automation-params-problem]').doesNotExist();
    await fillIn(inputOf('Value', param), 'cardstack/boxel');
    await waitForSave(
      (d) =>
        d.attributes.params.length === 1 &&
        d.attributes.params[0].name === 'repository' &&
        d.attributes.params[0].value === 'cardstack/boxel',
      'the param is saved',
    );
    await click('[data-test-automation-add-param]');
    await fillIn(
      inputOf(
        'Name',
        document.querySelector('[data-test-automation-param="1"]')!,
      ),
      'repository',
    );
    assert
      .dom('[data-test-automation-params-problem]')
      .hasText('Two params share the name “repository”');
    await click('[data-test-automation-remove-param="1"]');
    await click('[data-test-automation-remove-param="0"]');
    await waitForSave(
      (d) => d.attributes.params.length === 0,
      'removing it is saved',
    );
  });
  test('the fitted view says when it runs, and flags a missing script and batched AI', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}automations/nightly.json`,
    });
    await click('[data-test-format-chooser="fitted"]');
    await waitFor('[data-test-automation-fitted]');
    assert
      .dom('[data-test-automation-fitted-when]')
      .includesText('2:30 AM', 'the first trigger, as a phrase');
    assert
      .dom('[data-test-automation-fitted-more]')
      .hasText('Plus 1 more trigger', 'the other triggers, counted');
    assert
      .dom('[data-test-automation-fitted-no-script]')
      .doesNotExist('a card with a script raises no flag');
    assert
      .dom('[data-test-automation-fitted-batched-ai]')
      .doesNotExist('batched AI is off');

    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}automations/batched.json`,
    });
    await click('[data-test-format-chooser="fitted"]');
    await waitFor('[data-test-automation-fitted-no-script]');
    assert
      .dom('[data-test-automation-fitted-when]')
      .hasText('Once, at 9:00 AM on Jun 10, 2030');
    assert
      .dom('[data-test-automation-fitted-more]')
      .doesNotExist('one trigger has nothing more to count');
    assert
      .dom('[data-test-automation-fitted-no-script]')
      .hasText('No script yet');
    assert
      .dom('[data-test-automation-fitted-batched-ai]')
      .hasText('Batched AI');
  });
});
