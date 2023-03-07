/* eslint-env browser */
/* globals QUnit */

const { test } = QUnit;
const testRealmURL = 'http://localhost:4202/node-test';
const timeoutMs = 5000;
console.log('Test running');

function cleanWhiteSpace(text) {
  return text.replace(/\s+/g, ' ').trim();
}

async function boot(url, waitForSelector) {
  let container = document.getElementById('test-container');
  let iframe = document.createElement('iframe');
  iframe.setAttribute('src', url);
  container.append(iframe);
  if (waitForSelector) {
    let startTime = Date.now();
    while (
      (!iframe.contentDocument ||
        iframe.contentDocument.querySelector(waitForSelector) == null) &&
      Date.now() <= startTime + timeoutMs
    ) {
      await new Promise((res) => setTimeout(res, 100));
    }
    if (Date.now() > startTime + timeoutMs) {
      throw new Error(
        `timed out waiting for selector '${waitForSelector}' while booting ${url}`
      );
    }
  }
  return iframe.contentDocument;
}

function resetTestContainer() {
  let container = document.getElementById('test-container');
  let iframes = container.querySelectorAll('iframe');
  iframes.forEach((iframe) => iframe.remove());
}

QUnit.module('realm serving host app', function (hooks) {
  hooks.beforeEach(resetTestContainer);
  hooks.afterEach(resetTestContainer);

  test('renders app', async function (assert) {
    let doc = await boot(testRealmURL, 'a');
    assert.strictEqual(doc.location.href, `${testRealmURL}`);
    let p = doc.querySelector('p');
    assert.ok(p, '<p> element exists');
    assert.equal(
      cleanWhiteSpace(p.textContent),
      'The card code editor has moved to /code',
      'the index route is displayed'
    );
  });

  test('renders file tree', async function (assert) {
    let doc = await boot(`${testRealmURL}/code`, '.directory-level');
    assert.strictEqual(doc.location.href, `${testRealmURL}/code`);
    let nav = doc.querySelector('.main nav');
    assert.ok(nav, '<nav> element exists');
    let dirContents = nav.textContent;
    assert.ok(dirContents.includes('a.js'));
    assert.ok(dirContents.includes('b.js'));
    assert.ok(dirContents.includes('c.js'));
    assert.ok(dirContents.includes('card-ref-test.gts'));
    assert.ok(dirContents.includes('cycle-one.js'));
    assert.ok(dirContents.includes('cycle-two.js'));
    assert.ok(dirContents.includes('d.js'));
    assert.ok(dirContents.includes('dir/'));
    assert.ok(dirContents.includes('e.js'));
    assert.ok(dirContents.includes('person-1.json'));
    assert.ok(dirContents.includes('person-2.json'));
    assert.ok(dirContents.includes('person.gts'));
    assert.ok(dirContents.includes('unused-card.gts'));
  });
});
