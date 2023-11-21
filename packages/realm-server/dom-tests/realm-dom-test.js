/* eslint-env browser */
/* globals QUnit */
const { skip, test } = QUnit;
const testRealmURL = 'http://localhost:4202/node-test';
const testContainerId = 'test-container';
const iframeSelectorTempId = 'iframe-selector-temp';

class Messenger {
  #request;
  #destroyed = false;

  constructor(iframe) {
    this.iframe = iframe;
    window.addEventListener('message', this.handleEvent);
  }

  handleEvent = (event) => {
    if (this.#request === undefined) {
      throw new Error(
        `received response from iframe without corresponding request ${JSON.stringify(
          event.data,
        )}`,
      );
    }
    this.#request.deferred(event.data);
  };

  async send(message) {
    if (this.#destroyed) {
      throw new Error(`Cannot send message on destroyed Messenger`);
    }
    let deferred;
    let response = new Promise((res) => (deferred = res));
    this.#request = { deferred, message };
    this.iframe.contentWindow.postMessage(message, testRealmURL);
    let timeout = new Promise((_, reject) =>
      setTimeout(
        () =>
          reject(
            `timeout waiting for iframe to respond to ${JSON.stringify(
              message,
            )}`,
          ),
        5000,
      ),
    );
    let result = await Promise.race([response, timeout]);
    this.#request = undefined;
    return result;
  }

  destroy() {
    this.#destroyed = true;
    window.removeEventListener('message', this.handleEvent);
  }
}

function cleanWhiteSpace(text) {
  return text.replace(/\s+/g, ' ').trim();
}

async function waitFor(selector, messenger, timeoutMs = 10000) {
  let startTime = Date.now();
  while (
    (await querySelector(selector, messenger)) == null &&
    Date.now() <= startTime + timeoutMs
  ) {
    await new Promise((res) => setTimeout(res, 100));
  }
  if (Date.now() > startTime + timeoutMs) {
    throw new Error(`timed out waiting for selector '${selector}'`);
  }
}

function attachFragments(fragments) {
  let temp = document.getElementById(iframeSelectorTempId);
  if (!temp) {
    temp = document.createElement('div');
    temp.setAttribute('id', iframeSelectorTempId);
    document.body.appendChild(temp);
  }
  while (temp.firstChild) {
    temp.removeChild(temp.lastChild);
  }
  let template = document.createElement('template');
  if (Array.isArray(fragments)) {
    for (let fragment of fragments) {
      template.innerHTML = fragment;
      temp.appendChild(template.content);
    }
  } else {
    template.innerHTML = fragments;
    temp.appendChild(template.content);
  }
}

async function querySelector(selector, messenger) {
  let fragment = await messenger.send(
    { querySelector: selector },
    testRealmURL,
  );
  if (fragment == null) {
    return null;
  }
  attachFragments(fragment);
  let leafSelector = selector.split(' ').pop();
  return document.querySelector(`#${iframeSelectorTempId} > ${leafSelector}`);
}

async function querySelectorAll(selector, messenger) {
  let fragments = await messenger.send(
    { querySelectorAll: selector },
    testRealmURL,
  );
  attachFragments(fragments);
  let leafSelector = selector.split(' ').pop();
  return document.querySelectorAll(
    `#${iframeSelectorTempId} > ${leafSelector}`,
  );
}

async function boot(url, waitForSelector) {
  let container = document.getElementById(testContainerId);
  let iframe = document.createElement('iframe');
  iframe.setAttribute('src', url);
  container.append(iframe);
  // wait moment for iframe src to load
  await new Promise((res) => setTimeout(res, 500));
  let messenger = new Messenger(iframe);
  try {
    // waits for app to boot
    await waitFor(waitForSelector, messenger);
  } catch (err) {
    throw new Error(`error encountered while booting ${url}: ${err.message}`);
  }
  return messenger;
}

async function bootToCodeModeFile(pathToFile, waitForSelector) {
  let codeModeStateParam = JSON.stringify({
    stacks: [[]],
    submode: 'code',
    fileView: 'browser',
    codePath: `${testRealmURL}/${pathToFile}`,
  });

  let path = `?operatorModeEnabled=true&operatorModeState=${encodeURIComponent(
    codeModeStateParam,
  )}`;

  return await boot(`${testRealmURL}/${path}`, waitForSelector);
}

QUnit.module(
  'realm DOM tests (with base realm hosted assets)',
  function (hooks) {
    let messenger;

    function resetTestContainer() {
      if (messenger) {
        messenger.destroy();
      }
      let container = document.getElementById(testContainerId);
      let iframes = container.querySelectorAll('iframe');
      iframes.forEach((iframe) => iframe.remove());
    }

    hooks.beforeEach(resetTestContainer);
    hooks.afterEach(resetTestContainer);

    test('renders app', async function (assert) {
      messenger = await boot(testRealmURL, 'p');
      let location = await messenger.send('location');
      assert.strictEqual(location, `${testRealmURL}/`);
      let p = await querySelector('p', messenger);
      assert.ok(p, '<p> element exists');
      assert.equal(
        cleanWhiteSpace(p.textContent),
        'Hello, world',
        'the index route is displayed',
      );
    });

    test('renders file tree', async function (assert) {
      messenger = await bootToCodeModeFile(
        'person-1.json',
        '[data-test-directory-level]',
      );

      let nav = await querySelector('nav', messenger);
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
      assert.ok(dirContents.includes('person.json'));
      assert.ok(dirContents.includes('unused-card.gts'));
    });

    skip('renders card source', async function (assert) {
      messenger = await boot(
        `${testRealmURL}/code?openFile=person.gts`,
        '[data-test-card-id]',
      );
      let location = await messenger.send('location');
      assert.strictEqual(location, `${testRealmURL}/code?openFile=person.gts`);
      let cardId = await querySelector('[data-test-card-id', messenger);
      assert.ok(cardId, 'card ID element exists');
      assert.strictEqual(
        cleanWhiteSpace(cardId.textContent),
        `Card ID: ${testRealmURL}/person/Person`,
        'the card id is correct',
      );

      let fields = [
        ...(await querySelectorAll('[data-test-field]', messenger)),
      ];
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
      messenger = await bootToCodeModeFile('person-2.json', '[data-test-card]');

      let card = await querySelector('[data-test-card]', messenger);
      assert.strictEqual(
        cleanWhiteSpace(card.textContent),
        'Jackie',
        'the card is rendered correctly',
      );
    });

    test('can change routes', async function (assert) {
      messenger = await bootToCodeModeFile(
        'person.gts',
        '[data-test-directory-level]',
      );
      let error = await messenger.send({
        click: '[data-test-file="person-1.json"]',
      });
      if (error) {
        assert.ok(false, `encountered error: ${error}`);
      }

      await waitFor('[data-test-card]', messenger);
      let card = await querySelector('[data-test-card]', messenger);
      assert.strictEqual(
        cleanWhiteSpace(card.textContent),
        'Mango',
        'the card is rendered correctly',
      );
    });

    test('can render a card route', async function (assert) {
      messenger = await boot(`${testRealmURL}/person-1`, '[data-test-card]');
      let location = await messenger.send('location');
      assert.strictEqual(location, `${testRealmURL}/person-1`);
      let card = await querySelector('[data-test-card]', messenger);
      assert.strictEqual(
        cleanWhiteSpace(card.textContent),
        'Mango',
        'the card is rendered correctly',
      );
      let nav = await querySelector('.main nav', messenger);
      assert.notOk(nav, 'file tree is not rendered');
    });

    test('can show an error when navigating to nonexistent card route', async function (assert) {
      messenger = await boot(
        `${testRealmURL}/does-not-exist`,
        '[data-card-error]',
      );
      let location = await messenger.send('location');
      assert.strictEqual(location, `${testRealmURL}/does-not-exist`);
      let card = await querySelector('[data-test-card]', messenger);
      assert.notOk(card, 'no card rendered');
      let error = await querySelector('[data-card-error]', messenger);
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
