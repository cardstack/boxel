import { htmlSafe } from '@ember/template';
import { render } from '@ember/test-helpers';

import { setupChoreo } from '@cardstack/choreo/test-support';
import { getService } from '@universal-ember/test-support';

import type { Loader } from '@cardstack/runtime-common/loader';

import { setupBaseRealm } from './base-realm';
import { choreoGalleryContents } from './choreo-gallery';
import { setupMockMatrix } from './mock-matrix';
import { renderCard } from './render-component';
import { setupRenderingTest } from './setup';

import {
  setupCardLogs,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmURL,
  type RealmContents,
} from './index';

import type * as DemoModule from '../../../choreo-gallery/realm/demo';
import type * as GalleryModule from '../../../choreo-gallery/realm/gallery';
import type { ComponentLike } from '@glint/template';

/** a card instance document in the gallery realm, as much as the tests read */
export interface GalleryInstance {
  data: {
    attributes: Record<string, unknown> & {
      group?: string;
      lesson?: Record<string, unknown>;
      slug?: string;
      walkthrough?: Record<string, unknown>[];
    };
    meta: { adoptsFrom: { module: string; name: string } };
    relationships?: Record<string, { links: { self: string } }>;
  };
}

const CONTENTS = choreoGalleryContents();

/** an instance document of the gallery realm, by its path: `demos/fold.json` */
export function galleryInstance(path: string): GalleryInstance {
  return JSON.parse(CONTENTS[path] as string) as GalleryInstance;
}

/** the slugs of the demos the gallery's index links, in the order it links them */
export const GALLERY_DEMOS: string[] = Object.entries(
  galleryInstance('index.json').data.relationships ?? {},
)
  .map(([key, { links }]) => ({
    at: Number(/^demos\.(\d+)$/.exec(key)?.[1] ?? NaN),
    slug: links.self.replace(/^\.\/demos\//, ''),
  }))
  .filter(({ at }) => !Number.isNaN(at))
  .sort((a, b) => a.at - b.at)
  .map(({ slug }) => slug);

/**
 * A rendering test over the Choreo gallery realm: the gallery's own source is
 * served from a test realm, and its modules are imported through the loader,
 * so a test exercises the cards the gallery serves and the shimmed
 * glimmer-motion / Choreo the host hands them.
 */
export function setupChoreoGalleryTest(
  hooks: NestedHooks,
  opts: { contents?: RealmContents } = {},
) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);
  setupChoreo(hooks);
  let loader: Loader | undefined;

  setupLocalIndexing(hooks);
  setupCardLogs(
    hooks,
    async () => await gallery.loader.import('@cardstack/base/card-api'),
  );

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });

  hooks.beforeEach(async function () {
    loader = getService('loader-service').loader;
    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: { ...choreoGalleryContents(), ...opts.contents },
      skipBootIndex: true,
    });
  });

  let gallery = {
    get loader(): Loader {
      if (!loader) {
        throw new Error('the gallery test realm is set up in beforeEach');
      }
      return loader;
    },

    /** a module of the gallery realm, by its path there: `stages/fold` */
    async import<T = Record<string, unknown>>(path: string): Promise<T> {
      return (await gallery.loader.import(`${testRealmURL}${path}`)) as T;
    },

    /**
     * Render the gallery card, isolated, linking every demo its index links.
     * The test realm is not indexed, so the card is built from the realm's own
     * instance documents rather than loaded through the store.
     */
    async renderGallery() {
      let { DemoLesson, WalkthroughStep } =
        await gallery.import<typeof DemoModule>('demo');
      let demos = await Promise.all(
        GALLERY_DEMOS.map(async (slug) => {
          let { data } = galleryInstance(`demos/${slug}.json`);
          let { module, name } = data.meta.adoptsFrom;
          let classes = await gallery.import<
            Record<string, new (attrs: object) => DemoModule.GalleryDemo>
          >(module.replace(/^\.\.\//, ''));
          let { lesson, walkthrough, ...attributes } = data.attributes;
          return new classes[name]!({
            ...attributes,
            lesson: lesson ? new DemoLesson(lesson) : undefined,
            walkthrough: (walkthrough ?? []).map(
              (step) => new WalkthroughStep(step),
            ),
          });
        }),
      );
      let { ChoreoGallery } =
        await gallery.import<typeof GalleryModule>('gallery');
      await renderCard(
        gallery.loader,
        new ChoreoGallery({ demos }),
        'isolated',
      );
    },

    /** a named export of one of the gallery's stage modules */
    async stage(slug: string, name: string): Promise<ComponentLike> {
      let module = await gallery.import<Record<string, ComponentLike>>(
        `stages/${slug}`,
      );
      let Stage = module[name];
      if (!Stage) {
        throw new Error(`stages/${slug} has no export named ${name}`);
      }
      return Stage;
    },

    /**
     * Render a stage the way the demo page places it: inside the gallery's
     * root (its palette and type), in a well of a fixed size that is the
     * stage's platter container.
     */
    async renderStage(
      Stage: ComponentLike,
      { width = 1000, height = 660 }: { height?: number; width?: number } = {},
    ) {
      let { ChoreoRoot } = await gallery.import<{
        ChoreoRoot: ComponentLike<{
          Blocks: { default: [] };
          Element: HTMLDivElement;
        }>;
      }>('shell/choreo-root');
      let well = stageWellStyle({ width, height });
      // the stage signature's args are optional, and a test renders a stage
      // on its own with none of them
      let AnyStage = Stage as ComponentLike<{ Args: { face?: string } }>;
      await render(
        <template>
          <ChoreoRoot>
            <div class='choreo-stage-well' style={{well}}>
              <AnyStage @face='stage' />
            </div>
          </ChoreoRoot>
        </template>,
      );
    },
  };
  return gallery;
}

/**
 * The style of the well `renderStage` mounts a stage in: a box of a fixed size
 * that is the stage's platter container, as the demo page's well is.
 */
export function stageWellStyle({
  width = 1000,
  height = 660,
}: { height?: number; width?: number } = {}) {
  return htmlSafe(
    `position: relative; width: ${width}px; height: ${height}px; container-name: platter; container-type: size; overflow: clip;`,
  );
}

/**
 * Pin the test container to the viewport origin, unscaled, at a fixed size, so
 * a stage lays out at the size it is measured against. The default test page
 * draws the container at half scale, which halves every rectangle a test
 * reads.
 */
export function setupStageViewport(
  hooks: NestedHooks,
  { width = 1000, height = 660 }: { height?: number; width?: number } = {},
) {
  let style: HTMLStyleElement | undefined;
  hooks.beforeEach(function () {
    style = document.createElement('style');
    style.id = 'choreo-stage-viewport';
    style.textContent = `
      #ember-testing-container { position: fixed !important; left: 0 !important; top: 0 !important; width: ${width}px !important; height: ${height}px !important; overflow: visible !important; transform: none !important; zoom: 1 !important; margin: 0 !important; padding: 0 !important; border: 0 !important; z-index: 1; }
      #ember-testing { position: relative !important; width: 100% !important; height: 100% !important; transform: none !important; zoom: 1 !important; margin: 0 !important; padding: 0 !important; }
    `;
    document.head.appendChild(style);
    window.scrollTo(0, 0);
  });
  hooks.afterEach(function () {
    style?.remove();
    window.scrollTo(0, 0);
  });
}

/**
 * Wait out the next animation frame and then `count` more: `frames(0)` is the
 * next frame. The demos drive their clocks from the frame loop, outside the
 * run loop `settled()` waits on, so a test that needs a demo to have advanced
 * waits on painted frames.
 */
export function frames(count: number) {
  return new Promise<void>((resolve) => {
    /* eslint-disable @cardstack/boxel/no-raf-for-state -- waiting on paint is the point */
    let step = () => (count-- <= 0 ? resolve() : requestAnimationFrame(step));
    requestAnimationFrame(step);
    /* eslint-enable @cardstack/boxel/no-raf-for-state */
  });
}

export function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export const $ = (selector: string) =>
  document.querySelector(selector) as HTMLElement;

/**
 * A pointer event at (x, y) relative to the element's current top-left (its
 * centre when omitted), re-measured for every event. It bubbles to the
 * window, where drag sessions listen for moves and ups.
 */
export function trigger(
  target: Element | string,
  type: string,
  x?: number,
  y?: number,
  init: PointerEventInit = {},
) {
  let el = typeof target === 'string' ? $(target) : target;
  let r = el.getBoundingClientRect();
  let clientX = r.left + (x ?? r.width / 2);
  let clientY = r.top + (y ?? r.height / 2);
  let down = type === 'pointerdown' || type === 'pointermove';
  let event = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    clientX,
    clientY,
    screenX: clientX,
    screenY: clientY,
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
    button: 0,
    buttons: down ? 1 : 0,
    ...init,
  });
  el.dispatchEvent(event);
  return event;
}
