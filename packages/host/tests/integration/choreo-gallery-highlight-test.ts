/**
 * The sample highlighter, pinned on the one thing that broke it.
 *
 * Every demo's usage example runs through this, and the samples are
 * PROSE AND CODE TOGETHER — comments, block placeholders, a line of
 * narration. The naive quote rule read the apostrophe in "the film's
 * own type" as the start of a string and painted everything up to the
 * next apostrophe anywhere in the sample, which was most of the sample.
 */
import { module, test } from 'qunit';

import { choreoGalleryContents } from '../helpers/choreo-gallery';
import { setupChoreoGalleryTest } from '../helpers/choreo-gallery-stage';

import type * as HighlightModule from '../../../choreo-gallery/realm/lib/highlight';

let highlightSample: (typeof HighlightModule)['highlightSample'];

const html = (source: string) => highlightSample(source).toString();

/** the text of every span with the given class */
function spans(source: string, cls: string): string[] {
  const el = document.createElement('div');
  el.innerHTML = html(source);
  return [...el.querySelectorAll(`.syn-${cls}`)].map(
    (s) => s.textContent ?? '',
  );
}

/** every demo instance in the gallery realm, with its usage example */
function demoSamples(): { sample: string; slug: string }[] {
  return Object.entries(choreoGalleryContents())
    .filter(([path]) => /^demos\/[^/]+\.json$/.test(path))
    .map(([, source]) => {
      let { attributes } = JSON.parse(source as string).data;
      return { slug: attributes.slug, sample: attributes.sample ?? '' };
    });
}

module('Integration | Choreo gallery | highlight', function (hooks) {
  let gallery = setupChoreoGalleryTest(hooks);

  hooks.beforeEach(async function () {
    ({ highlightSample } =
      await gallery.import<typeof HighlightModule>('lib/highlight'));
  });

  test('an apostrophe in prose does not open a string', function (assert) {
    const source = [
      "<:gate as |f|>…the door, in the film's own type…</:gate>",
      '',
      "{ id: 'gaudi', ch: 2 }",
    ].join('\n');

    assert.deepEqual(
      spans(source, 'string'),
      ["'gaudi'"],
      'the only string is the real one; the apostrophe is punctuation',
    );
  });

  test('a string still closes on its own line', function (assert) {
    assert.deepEqual(
      spans("vo: 'On the seventh of June 1926.'", 'string'),
      ["'On the seventh of June 1926.'"],
      'and it is one span, not one per word',
    );
  });

  test('a quote that never closes is punctuation, not the rest of the file', function (assert) {
    const source = "// the fan's incline\nconst k = 2;";
    assert.deepEqual(spans(source, 'string'), [], 'no string at all');
    assert.true(
      html(source).includes('const'),
      'and the code after it is still tokenised',
    );
  });

  test('a named block is a tag', function (assert) {
    const tags = spans('<:gate as |f|>hi</:gate>', 'tag');
    assert.true(
      tags.length > 0,
      `<:gate> is read as a tag rather than loose atoms (${tags.join('|')})`,
    );
  });

  test('every demo sample highlights without a runaway string', async function (assert) {
    const samples = demoSamples();
    assert.true(samples.length > 40, `read ${samples.length} demo samples`);
    const runaway = samples
      .map((demo) => ({
        id: demo.slug,
        longest: Math.max(
          0,
          ...spans(demo.sample, 'string').map((s) => s.length),
        ),
      }))
      /* a string longer than a line of code is one that swallowed the
         rest of the sample */
      .filter((row) => row.longest > 120);

    assert.deepEqual(
      runaway.map((r) => `${r.id} (${r.longest})`),
      [],
      'no sample has a string span that ran past its line',
    );
  });
});
