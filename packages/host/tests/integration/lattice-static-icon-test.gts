import { find, render } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { computeContentHash } from '@cardstack/runtime-common';
import { staticIconSvg } from '@cardstack/runtime-common/static-icon';

import { getFileIndexMetadata } from '@cardstack/host/utils/file-def-attributes-extractor';
import { getStaticIconSvg } from '@cardstack/host/utils/static-icon';

import { setupBaseRealm, FileDef } from '../helpers/base-realm';
import { setupRenderingTest } from '../helpers/setup';

import type * as CardAPI from '@cardstack/base/card-api';
import type * as JsonFileModule from '@cardstack/base/json-file-def';

module('Integration | Lattice static SVG icon', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);

  test('generated JSON SVG matches its live component and is reused without a record', async function (assert) {
    const { JsonFileDef } = await getService('loader-service').loader.import<
      typeof JsonFileModule
    >('@cardstack/base/json-file-def');
    const artifact = getStaticIconSvg(JsonFileDef, FileDef)!;
    assert.ok(
      artifact,
      'generated SVG is available without constructing a FileDef',
    );
    assert.strictEqual(
      artifact.contentHash,
      computeContentHash(new TextEncoder().encode(artifact.svg)),
    );
    const api = await getService('loader-service').loader.import<
      typeof CardAPI
    >('@cardstack/base/card-api');
    const metadata = getFileIndexMetadata(api, JsonFileDef)!;
    assert.deepEqual(
      metadata.types.map((ref) => ('name' in ref ? ref.name : undefined)),
      ['JsonFileDef', 'FileDef', 'BaseDef'],
      'captured file ancestry includes the common base',
    );
    assert.deepEqual(metadata.displayNames, ['JSON', 'File']);
    assert.strictEqual(
      metadata.staticIcon,
      artifact,
      'definition capture carries the validated SVG without rendering a file',
    );
    assert.strictEqual(
      getFileIndexMetadata(api, api.CardDef),
      undefined,
      'card definitions do not acquire file extraction metadata',
    );
    const Icon = JsonFileDef.icon;
    await render(<template><Icon /></template>);
    const stored = document.createElement('template');
    stored.innerHTML = artifact.svg;
    assert.true(
      find('svg')!.isEqualNode(stored.content.firstElementChild),
      'the artifact has exactly the same SVG DOM as the component',
    );
    assert.strictEqual(
      stored.content.firstElementChild!.getAttribute('stroke'),
      'currentColor',
    );
    class AnotherJsonFile extends JsonFileDef {}
    assert.strictEqual(getStaticIconSvg(AnotherJsonFile, FileDef), artifact);
  });

  test('custom selectors and getters do not acquire static icon authority', function (assert) {
    class Selector extends FileDef {
      static getIconComponent(): never {
        throw new Error('must not execute the selector');
      }
    }
    class Getter extends FileDef {}
    Object.defineProperty(Getter, 'icon', {
      get() {
        throw new Error('must not evaluate the icon getter');
      },
    });
    assert.strictEqual(getStaticIconSvg(Selector, FileDef), undefined);
    assert.strictEqual(getStaticIconSvg(Getter, FileDef), undefined);
  });

  test('a new icon version replaces the artifact; malformed or mutable artifacts fall back', function (assert) {
    function definition(svg: string, hash?: string, mutable = false) {
      const Icon = <template><svg /></template>;
      const value = {
        svg,
        contentHash: hash ?? computeContentHash(new TextEncoder().encode(svg)),
      };
      Object.defineProperty(Icon, staticIconSvg, {
        value: mutable ? value : Object.freeze(value),
      });
      return class extends FileDef {
        static icon = Icon;
      };
    }
    const first = getStaticIconSvg(
      definition(
        '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>',
      ),
      FileDef,
    )!;
    const second = getStaticIconSvg(
      definition(
        '<svg xmlns="http://www.w3.org/2000/svg"><path d="M1 1"/></svg>',
      ),
      FileDef,
    )!;
    assert.notStrictEqual(first.contentHash, second.contentHash);
    assert.strictEqual(
      getStaticIconSvg(definition('<svg/>', 'wrong'), FileDef),
      undefined,
    );
    assert.strictEqual(
      getStaticIconSvg(definition('<svg/>', undefined, true), FileDef),
      undefined,
    );
    assert.strictEqual(
      getStaticIconSvg(definition('<div>not svg</div>'), FileDef),
      undefined,
    );
    const sanitized = getStaticIconSvg(
      definition(
        '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script><path d="M0 0"/></svg>',
      ),
      FileDef,
    )!;
    assert.false(sanitized.svg.includes('onload'));
    assert.false(sanitized.svg.includes('script'));
  });
});
