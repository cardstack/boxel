import QUnit from 'qunit';
import { basename } from 'node:path';
import {
  baseCardTitle,
  baseCardDescription,
  baseCardTheme,
  baseCardThumbnailURL,
} from '@cardstack/runtime-common/base-card-computations';
const { module, test } = QUnit;

module(basename(import.meta.filename), function () {
  test('title and description retain base blank and whitespace semantics', function (assert) {
    assert.strictEqual(baseCardTitle({}, 'Student'), 'Untitled Student');
    assert.strictEqual(
      baseCardTitle({ name: '   ' }, 'Student'),
      'Untitled Student',
    );
    assert.strictEqual(
      baseCardTitle({ name: '  Avery  ' }, 'Student'),
      '  Avery  ',
    );
    assert.strictEqual(
      baseCardTitle({ name: 'Avery' }, () => {
        throw new Error('Title did not need displayName');
      }),
      'Avery',
    );
    assert.strictEqual(baseCardDescription({}), undefined);
    assert.strictEqual(baseCardDescription({ summary: null }), null);
    assert.strictEqual(
      baseCardDescription({ summary: 'A summary' }),
      'A summary',
    );
  });
  test('theme preserves the supplied reference and thumbnail reads only its selected fallback', function (assert) {
    const theme = { id: 'https://example.com/Theme/one' };
    assert.strictEqual(baseCardTheme({ theme }), theme);
    let imageReads = 0,
      screenshotReads = 0;
    const info = {
      cardThumbnailURL: 'authored.png',
      get cardThumbnail() {
        imageReads++;
        return { url: 'image.png' };
      },
    };
    const screenshot = () => {
      screenshotReads++;
      return 'capture.png';
    };
    assert.strictEqual(baseCardThumbnailURL(info, screenshot), 'authored.png');
    assert.strictEqual(imageReads, 0);
    assert.strictEqual(screenshotReads, 0);
    info.cardThumbnailURL = '';
    assert.strictEqual(baseCardThumbnailURL(info, screenshot), 'image.png');
    assert.strictEqual(imageReads, 1);
    assert.strictEqual(screenshotReads, 0);
    assert.strictEqual(baseCardThumbnailURL({}, screenshot), 'capture.png');
    assert.strictEqual(screenshotReads, 1);
    assert.strictEqual(
      baseCardThumbnailURL({}, () => undefined),
      undefined,
    );
  });
});
