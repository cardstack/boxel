// The resource primitives let a template author use a file as an ingredient in
// an authored layout rather than delegating to a file card. The contract that
// makes that possible is narrow and worth pinning: each component emits exactly
// one native element and no wrapper DOM, and `FileResource` emits none at all.
//
// `precompileTemplate` is a build-time macro, so every template below has to be
// a literal at its call site — a runtime-loaded component can't be referenced
// from a static `<template>`, and the template string can't be a variable.

// @ts-ignore no public types for `precompileTemplate`
import { precompileTemplate } from '@ember/template-compilation';
import { render } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { baseRealm, type Loader } from '@cardstack/runtime-common';

import { setupBaseRealm } from '../../helpers/base-realm';
import { setupRenderingTest } from '../../helpers/setup';

import type * as CardApiModule from '@cardstack/base/card-api';
import type * as FileResourcesModule from '@cardstack/base/file-formats/file-resources';

module('Integration | FileDef resource primitives', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);

  let loader: Loader;
  let FileDef: typeof CardApiModule.FileDef;
  let FileResource: typeof FileResourcesModule.FileResource;
  let FileImage: typeof FileResourcesModule.FileImage;
  let FileAudio: typeof FileResourcesModule.FileAudio;
  let FileVideo: typeof FileResourcesModule.FileVideo;
  let FileObject: typeof FileResourcesModule.FileObject;
  let applyFileFont: typeof FileResourcesModule.applyFileFont;
  let fileResourceURL: typeof FileResourcesModule.fileResourceURL;

  hooks.beforeEach(async function () {
    loader = getService('loader-service').loader;
    FileDef = (
      await loader.import<typeof CardApiModule>(`${baseRealm.url}card-api`)
    ).FileDef;
    ({
      FileResource,
      FileImage,
      FileAudio,
      FileVideo,
      FileObject,
      applyFileFont,
      fileResourceURL,
    } = await loader.import<typeof FileResourcesModule>(
      '@cardstack/base/file-formats/file-resources',
    ));
  });

  function imageFile() {
    return new FileDef({
      id: 'http://example.com/img/hero.png',
      url: 'http://example.com/img/hero.png',
      sourceUrl: 'http://example.com/img/hero.png',
      name: 'hero.png',
      contentType: 'image/png',
    });
  }

  test('one URL precedence order applies to every primitive', function (assert) {
    let file = {
      url: 'http://example.com/from-url',
      id: 'http://example.com/from-id',
      sourceUrl: 'http://example.com/from-source',
    };
    assert.strictEqual(
      fileResourceURL(file, 'http://example.com/explicit'),
      'http://example.com/explicit',
      'an explicit URL wins',
    );
    assert.strictEqual(fileResourceURL(file), 'http://example.com/from-url');
    assert.strictEqual(
      fileResourceURL({ id: file.id, sourceUrl: file.sourceUrl }),
      'http://example.com/from-id',
    );
    assert.strictEqual(
      fileResourceURL({ sourceUrl: file.sourceUrl }),
      'http://example.com/from-source',
    );
    assert.strictEqual(fileResourceURL(undefined), '');
    assert.strictEqual(
      fileResourceURL(null, new URL('http://example.com/a.png')),
      'http://example.com/a.png',
      'a URL object normalizes the same as a string',
    );
  });

  test('FileResource yields resolved facts and emits no DOM of its own', async function (assert) {
    let file = imageFile();
    await render(
      precompileTemplate(
        `<div class="probe"><FileResource @file={{file}} as |resource|>
           <span class="url">{{resource.url}}</span>
           <span class="kind">{{resource.profile.kind}}</span>
           <span class="family">{{resource.profile.family}}</span>
           <span class="has">{{if resource.hasURL "yes" "no"}}</span>
         </FileResource></div>`,
        { strictMode: true, scope: () => ({ FileResource, file }) },
      ),
    );
    assert.dom('.url').hasText('http://example.com/img/hero.png');
    assert.dom('.kind').hasText('PNG image');
    assert.dom('.family').hasText('image');
    assert.dom('.has').hasText('yes');
    assert.strictEqual(
      document.querySelectorAll('.probe > *').length,
      4,
      'only the yielded block content renders — no wrapper element',
    );
  });

  test('FileResource reports a file with no resource as having no URL', async function (assert) {
    let file = new FileDef({});
    await render(
      precompileTemplate(
        `<FileResource @file={{file}} as |resource|>
           <span class="has">{{if resource.hasURL "yes" "no"}}</span>
         </FileResource>`,
        { strictMode: true, scope: () => ({ FileResource, file }) },
      ),
    );
    assert.dom('.has').hasText('no');
  });

  // A filename or URL is untrusted input and it lands inside a CSS
  // declaration, so it has to stay within one quoted token.
  test('FileResource keeps a quoted URL from escaping the background declaration', async function (assert) {
    let file = new FileDef({
      url: 'http://example.com/a".png";color:red;--x:"',
      name: 'a.png',
    });
    await render(
      precompileTemplate(
        `<FileResource @file={{file}} as |resource|>
           <span class="bg" style={{resource.backgroundStyle}}></span>
         </FileResource>`,
        { strictMode: true, scope: () => ({ FileResource, file }) },
      ),
    );
    assert.notStrictEqual(
      getComputedStyle(document.querySelector('.bg')!).color,
      'rgb(255, 0, 0)',
      'the injected declaration did not take effect',
    );
  });

  test('FileImage emits exactly one img and passes attributes through', async function (assert) {
    let file = imageFile();
    await render(
      precompileTemplate(
        `<div class="probe"><FileImage
            @file={{file}}
            @loading="lazy"
            class="hero"
          /></div>`,
        { strictMode: true, scope: () => ({ FileImage, file }) },
      ),
    );
    assert.strictEqual(document.querySelectorAll('.probe img').length, 1);
    assert
      .dom('.probe img')
      .hasAttribute('src', 'http://example.com/img/hero.png')
      .hasAttribute('alt', 'hero.png')
      .hasAttribute('loading', 'lazy')
      .hasClass('hero');
    assert.strictEqual(
      document.querySelector('.probe')!.children.length,
      1,
      'no wrapper element around the img',
    );
  });

  test('FileImage renders nothing rather than a broken image when there is no URL', async function (assert) {
    let file = new FileDef({ name: 'x.png' });
    await render(
      precompileTemplate(
        `<div class="probe"><FileImage @file={{file}} /></div>`,
        {
          strictMode: true,
          scope: () => ({ FileImage, file }),
        },
      ),
    );
    assert.dom('.probe img').doesNotExist();
  });

  test('FileAudio emits exactly one native player with controls by default', async function (assert) {
    let file = new FileDef({
      url: 'http://example.com/a/take.mp3',
      name: 'take.mp3',
      contentType: 'audio/mpeg',
    });
    await render(
      precompileTemplate(
        `<div class="probe"><FileAudio @file={{file}} /></div>`,
        {
          strictMode: true,
          scope: () => ({ FileAudio, file }),
        },
      ),
    );
    assert.strictEqual(document.querySelectorAll('.probe audio').length, 1);
    assert
      .dom('.probe audio')
      .hasAttribute('src', 'http://example.com/a/take.mp3')
      .hasAttribute('controls');
    assert.strictEqual(document.querySelector('.probe')!.children.length, 1);
  });

  test('FileVideo emits exactly one native player with the poster applied', async function (assert) {
    let file = new FileDef({
      url: 'http://example.com/v/clip.mp4',
      name: 'clip.mp4',
      contentType: 'video/mp4',
    });
    await render(
      precompileTemplate(
        `<div class="probe"><FileVideo
            @file={{file}}
            @poster="http://example.com/v/poster.jpg"
          /></div>`,
        { strictMode: true, scope: () => ({ FileVideo, file }) },
      ),
    );
    assert.strictEqual(document.querySelectorAll('.probe video').length, 1);
    assert
      .dom('.probe video')
      .hasAttribute('src', 'http://example.com/v/clip.mp4')
      .hasAttribute('poster', 'http://example.com/v/poster.jpg')
      .hasAttribute('playsinline');
  });

  // `@loadAsBlob` withholds the rendered `src` so the browser can't fire an
  // unauthenticated request before the fetch runs, then assigns an object URL.
  // When that fetch can't succeed — as here, where the host is unreachable —
  // playback has to degrade to the canonical source rather than disappear.
  test('FileAudio falls back to the canonical source when the blob fetch fails', async function (assert) {
    let file = new FileDef({
      url: 'http://example.com/a/take.mp3',
      name: 'take.mp3',
    });
    await render(
      precompileTemplate(`<FileAudio @file={{file}} @loadAsBlob={{true}} />`, {
        strictMode: true,
        scope: () => ({ FileAudio, file }),
      }),
    );
    assert
      .dom('audio')
      .hasAttribute(
        'src',
        'http://example.com/a/take.mp3',
        'the element is playable from the canonical URL',
      );
    assert.notOk(
      document.querySelector('audio')!.src.startsWith('blob:'),
      'no object URL was left behind',
    );
  });

  test('FileAudio exposes the native element to a caller with its own controls', async function (assert) {
    let file = new FileDef({ url: 'http://example.com/a/take.mp3' });
    let captured: HTMLAudioElement | null = null;
    let onElement = (element: HTMLAudioElement | null) => {
      if (element) {
        captured = element;
      }
    };
    await render(
      precompileTemplate(
        `<FileAudio @file={{file}} @onElement={{onElement}} />`,
        {
          strictMode: true,
          scope: () => ({ FileAudio, file, onElement }),
        },
      ),
    );
    assert.strictEqual(
      captured,
      document.querySelector('audio'),
      'the caller receives the exact rendered element',
    );
  });

  test('FileObject emits exactly one object carrying the resource type', async function (assert) {
    let file = new FileDef({
      url: 'http://example.com/docs/report.pdf',
      name: 'report.pdf',
      contentType: 'application/pdf',
    });
    await render(
      precompileTemplate(
        `<div class="probe"><FileObject @file={{file}}>
           <span class="fallback">No viewer</span>
         </FileObject></div>`,
        { strictMode: true, scope: () => ({ FileObject, file }) },
      ),
    );
    assert.strictEqual(document.querySelectorAll('.probe object').length, 1);
    assert
      .dom('.probe object')
      .hasAttribute('data', 'http://example.com/docs/report.pdf')
      .hasAttribute('type', 'application/pdf')
      .hasAttribute('aria-label', 'report.pdf');
    assert.dom('.probe object .fallback').exists('the block is the fallback');
  });

  test('applyFileFont leaves the theme font in place when there is no resource', async function (assert) {
    let file = new FileDef({});
    await render(
      precompileTemplate(
        `<span class="specimen" {{applyFileFont file undefined undefined}}>Aa</span>`,
        { strictMode: true, scope: () => ({ applyFileFont, file }) },
      ),
    );
    assert.strictEqual(
      (document.querySelector('.specimen') as HTMLElement).style.fontFamily,
      '',
      'no font-family was set',
    );
  });
});
