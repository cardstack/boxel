/* eslint-env browser */
/* globals QUnit */

const { skip, test } = QUnit;
const testRealmURL = 'http://localhost:4202/node-test';
const testContainerId = 'test-container';

function cleanWhiteSpace(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function testDocument() {
  let iframe = document.querySelector(`#${testContainerId} iframe`);
  if (!iframe) {
    throw new Error(`cannot find test-container's iframe`);
  }
  return iframe.contentDocument;
}

async function waitFor(selector, timeoutMs = 10000) {
  let startTime = Date.now();
  while (
    querySelector(selector) == null &&
    Date.now() <= startTime + timeoutMs
  ) {
    await new Promise((res) => setTimeout(res, 100));
  }
  if (Date.now() > startTime + timeoutMs) {
    throw new Error(`timed out waiting for selector '${selector}'`);
  }
}

function querySelector(selector) {
  let doc = testDocument();
  return doc?.querySelector(selector);
}

function querySelectorAll(selector) {
  let doc = testDocument();
  return doc?.querySelectorAll(selector);
}

async function boot(url, waitForSelector) {
  let container = document.getElementById(testContainerId);
  let iframe = document.createElement('iframe');
  iframe.setAttribute('src', url);
  container.append(iframe);
  try {
    await waitFor(waitForSelector);
  } catch (err) {
    throw new Error(`error encountered while booting ${url}: ${err.message}`);
  }
}

function resetTestContainer() {
  let container = document.getElementById(testContainerId);
  let iframes = container.querySelectorAll('iframe');
  iframes.forEach((iframe) => iframe.remove());
}

QUnit.module(
  'realm DOM tests (with base realm hosted assets)',
  function (hooks) {
    hooks.beforeEach(resetTestContainer);
    hooks.afterEach(resetTestContainer);

    test('renders app', async function (assert) {
      await boot(testRealmURL, 'a');
      assert.strictEqual(testDocument().location.href, `${testRealmURL}/`);
      let p = querySelector('p');
      assert.ok(p, '<p> element exists');
      assert.equal(
        cleanWhiteSpace(p.textContent),
        'Hello, world',
        'the index route is displayed',
      );
    });

    test('renders file tree', async function (assert) {
      let codeModeStateParam = JSON.stringify({
        stacks: [
          [
            {
              id: `${testRealmURL}/person-1`,
              format: 'isolated',
            },
          ],
        ],
        submode: 'code',
        fileView: 'browser',
        codePath: `${testRealmURL}/person-1.json`,
      });

      let path = `?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
        codeModeStateParam,
      )}`;

      await boot(`${testRealmURL}/${path}`, '[data-test-directory-level]');
      assert.strictEqual(
        testDocument().location.href,
        `${testRealmURL}/${path}`,
      );

      let nav = querySelector('nav');
      assert.ok(nav, '<nav> element exists');
      let dirContents = nav.textContent;
      assert.ok(dirContents.includes('a.js'));
      assert.ok(dirContents.includes('b.js'));
      assert.ok(dirContents.includes('c.js'));
      assert.ok(dirContents.includes('code-ref-test.gts'));
      assert.ok(dirContents.includes('cycle-one.js'));
      assert.ok(dirContents.includes('cycle-two.js'));
      assert.ok(dirContents.includes('d.js'));
      assert.ok(dirContents.includes('dir/'));
      assert.ok(dirContents.includes('e.js'));
      assert.ok(dirContents.includes('home.gts'));
      assert.ok(dirContents.includes('index.json'));
      assert.ok(dirContents.includes('person-1.json'));
      assert.ok(dirContents.includes('person-2.json'));
      assert.ok(dirContents.includes('person.gts'));
      assert.ok(dirContents.includes('unused-card.gts'));
    });

    skip('renders card source', async function (assert) {
      await boot(
        `${testRealmURL}/code?openFile=person.gts`,
        '[data-test-card-id]',
      );
      assert.strictEqual(
        testDocument().location.href,
        `${testRealmURL}/code?openFile=person.gts`,
      );
      let cardId = querySelector('[data-test-card-id');
      assert.ok(cardId, 'card ID element exists');
      assert.strictEqual(
        cleanWhiteSpace(cardId.textContent),
        `Card ID: ${testRealmURL}/person/Person`,
        'the card id is correct',
      );

      let fields = [...querySelectorAll('[data-test-field]')];
      assert.strictEqual(fields.length, 3, 'number of fields is correct');
      assert.strictEqual(
        cleanWhiteSpace(fields[0].textContent),
        `Delete firstName - contains - field card ID: https://cardstack.com/base/string/default`,
        'field is correct',
      );
      assert.strictEqual(
        cleanWhiteSpace(fields[1].textContent),
        `description - contains - field card ID: https://cardstack.com/base/string/default`,
        'description field is correct',
      );
      assert.strictEqual(
        cleanWhiteSpace(fields[2].textContent),
        `thumbnailURL - contains - field card ID: https://cardstack.com/base/string/default`,
        'thumbnailURL field is correct',
      );
    });

    test('renders card instance', async function (assert) {
      let codeModeStateParam = JSON.stringify({
        stacks: [
          [
            {
              id: `${testRealmURL}/person-2`,
              format: 'isolated',
            },
          ],
        ],
        submode: 'code',
        fileView: 'browser',
        codePath: `${testRealmURL}/person-2.json`,
      });

      let path = `?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
        codeModeStateParam,
      )}`;

      await boot(`${testRealmURL}/${path}`, '[data-test-card]');

      let card = querySelector('[data-test-card]');
      assert.strictEqual(
        cleanWhiteSpace(card.textContent),
        'Jackie',
        'the card is rendered correctly',
      );
    });

    test('can change routes', async function (assert) {
      let codeModeStateParam = JSON.stringify({
        stacks: [
          [
            {
              id: `${testRealmURL}/person-2`,
              format: 'isolated',
            },
          ],
        ],
        submode: 'code',
        fileView: 'browser',
        codePath: `${testRealmURL}/person.gts`,
      });

      let path = `?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
        codeModeStateParam,
      )}`;

      await boot(`${testRealmURL}/${path}`, '[data-test-directory-level]');
      let files = querySelectorAll('nav .file');
      let instance = [...files].find(
        (file) => cleanWhiteSpace(file.textContent) === 'person-1.json',
      );
      assert.ok(instance, 'card instance file element exists');
      instance.click();

      await waitFor('[data-test-card]');
      let card = querySelector('[data-test-card]');
      assert.strictEqual(
        cleanWhiteSpace(card.textContent),
        'Mango',
        'the card is rendered correctly',
      );
    });

    test('can render a card route', async function (assert) {
      await boot(`${testRealmURL}/person-1`, '[data-test-card]');
      assert.strictEqual(
        testDocument().location.href,
        `${testRealmURL}/person-1`,
      );
      let card = querySelector('[data-test-card]');
      assert.strictEqual(
        cleanWhiteSpace(card.textContent),
        'Mango',
        'the card is rendered correctly',
      );
      let nav = querySelector('.main nav');
      assert.notOk(nav, 'file tree is not rendered');
    });

    test('can show an error when navigating to nonexistent card route', async function (assert) {
      await boot(`${testRealmURL}/does-not-exist`, '[data-card-error]');
      assert.strictEqual(
        testDocument().location.href,
        `${testRealmURL}/does-not-exist`,
      );
      let card = querySelector('[data-test-card]');
      assert.notOk(card, 'no card rendered');
      let error = querySelector('[data-card-error]');
      assert.ok(
        cleanWhiteSpace(error.textContent).includes(`Cannot load card`),
        'error message is displayed',
      );
      assert.ok(
        cleanWhiteSpace(error.textContent).includes(
          `Could not find ${testRealmURL}/does-not-exist`,
        ),
        'error message is displayed',
      );
    });
  },
);
