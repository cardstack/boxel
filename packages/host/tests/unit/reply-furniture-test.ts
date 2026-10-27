import { module, test } from 'qunit';

import { markReplyFurniture } from '@cardstack/host/lib/reply-furniture';

function paragraph(html: string): HTMLElement {
  let root = document.createElement('div');
  root.innerHTML = `<p>${html}</p>`;
  markReplyFurniture(root);
  return root.querySelector('p')!;
}

module('Unit | markReplyFurniture', function () {
  test('a Method line opens and closes from its label, a real button', function (assert) {
    let p = paragraph(
      '<strong>Method:</strong> searched <a href="https://example.com">two sources</a>',
    );
    let toggle = p.querySelector('button')!;
    assert.strictEqual(p.dataset.method, 'true');
    assert.strictEqual(
      p.getAttribute('role'),
      null,
      'the line is not a button',
    );
    assert.strictEqual(toggle.type, 'button');
    assert.strictEqual(toggle.textContent, 'Method:');
    assert.strictEqual(toggle.getAttribute('aria-expanded'), 'false');

    toggle.click();
    assert.strictEqual(p.dataset.open, 'true');
    assert.strictEqual(toggle.getAttribute('aria-expanded'), 'true');

    toggle.click();
    assert.strictEqual(p.dataset.open, 'false');
    assert.strictEqual(toggle.getAttribute('aria-expanded'), 'false');
  });

  test('a stat row of figures and their words becomes labeled chips', function (assert) {
    let p = paragraph(
      '<code>$15</code> race-day benchmark <code>$10–$11.60</code> Burpee Open',
    );
    assert.strictEqual(p.dataset.chips, 'labeled');
    assert.strictEqual(p.querySelectorAll('[data-chip]').length, 2);
  });

  test('a sentence that names code stays prose', function (assert) {
    let p = paragraph(
      '<code>relaunch.gts</code> exports the <code>PosterOption</code> and <code>RelaunchPlan</code> card classes, <code>PlanChange</code>',
    );
    assert.strictEqual(p.dataset.chips, undefined);
    assert.strictEqual(p.querySelectorAll('[data-chip]').length, 0);
  });

  test('a stat row still streaming, with the caret in it, is already chips', function (assert) {
    let p = paragraph(
      '<code>$15</code> race-day benchmark <code>$10</code> Burpee Open<span data-markdown-caret></span>',
    );
    assert.strictEqual(
      p.dataset.chips,
      'labeled',
      'it does not regroup when the reply settles',
    );
    let row = paragraph(
      '<code>6 shops</code> · <code>checked Oct 20</code><span data-markdown-caret></span>',
    );
    assert.strictEqual(row.dataset.chips, 'true');
  });
});
