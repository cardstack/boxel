import { registerDestructor } from '@ember/destroyable';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import config from 'choreo-gallery/config/environment';
import { modifier } from 'ember-modifier';
import { motion } from 'glimmer-motion';

const FRAME_FROM = { opacity: 0, scale: 0.97 } as const;
const FRAME_TO = { opacity: 1, scale: 1 } as const;
const FRAME_IN = { duration: 0.5, ease: [0.22, 1, 0.36, 1] } as const;
const asset = (path: string) => `${config.rootURL}${path}`;

interface RawDocumentFrameSignature {
  Args: { route: string; title: string };
  Element: HTMLIFrameElement;
}

/**
 * Realm HTML paths are first-class Boxel files, so navigating an iframe to
 * one opens the HTML File card. Follow Boxel's own HtmlPreview contract:
 * fetch the authenticated source and execute it in an opaque-origin srcdoc.
 */
class RawDocumentFrame extends Component<RawDocumentFrameSignature> {
  @tracked source?: string;
  @tracked failed = false;
  private abort = new AbortController();
  private experienceSource?: string;
  private experienceName?: 'sagrada' | 'towers';

  constructor(owner: unknown, args: RawDocumentFrameSignature['Args']) {
    super(owner as never, args);
    void this.load();
    registerDestructor(this, () => this.abort.abort());
  }

  get sandbox(): string {
    /* <Film> owns a second srcdoc and its live Picture port is deliberately a
       direct window object. Sagrada therefore needs the two trusted, generated
       documents to share an origin; the other experiences stay opaque. */
    return this.args.route === '_sagrada'
      ? 'allow-scripts allow-pointer-lock allow-same-origin'
      : 'allow-scripts allow-pointer-lock';
  }

  private async load() {
    const sourceURL = new URL(asset('iframe/index.html'), document.baseURI);
    try {
      const request = async (url: URL, init: RequestInit = {}) => {
        let response: Response | undefined;
        for (let attempt = 0; attempt < 5; attempt++) {
          response = await fetch(url, {
            credentials: 'same-origin',
            ...init,
            signal: this.abort.signal,
          });
          if (![502, 503, 504].includes(response.status) || attempt === 4) {
            return response;
          }
          await new Promise<void>((resolve, reject) => {
            const timer = window.setTimeout(resolve, 400 * 2 ** attempt);
            this.abort.signal.addEventListener(
              'abort',
              () => {
                window.clearTimeout(timer);
                reject(this.abort.signal.reason);
              },
              { once: true },
            );
          });
        }
        return response!;
      };
      const response = await request(sourceURL);
      if (!response.ok) {
        throw new Error(`iframe source returned ${response.status}`);
      }
      const html = await response.text();
      const base = `<base href="${sourceURL.href.replace(/index\.html$/, '')}">`;
      const route = `<script>location.hash=${JSON.stringify(`/${this.args.route}?embed`)}</script>`;
      if (this.args.route === '_towers' || this.args.route === '_sagrada') {
        /* Boxel deliberately removes fetch/XHR from an opaque preview. Fetch
           the self-contained vendor page in the parent, then carry its text
           across the sandbox boundary after the small srcdoc has booted. */
        const name = this.args.route === '_towers' ? 'towers' : 'sagrada';
        const experienceURL = new URL(
          asset(`iframe/${name}.html`),
          document.baseURI,
        );
        const experienceResponse = await request(experienceURL);
        if (!experienceResponse.ok) {
          throw new Error(
            `${name} source returned ${experienceResponse.status}`,
          );
        }
        let experienceSource = await experienceResponse.text();
        if (name === 'towers') {
          const nativeVoiceFetch = 'filmVoiceBufs[url] = fetch(url)';
          if (!experienceSource.includes(nativeVoiceFetch)) {
            throw new Error('tower source is missing its voice fetch hook');
          }
          experienceSource = experienceSource.replace(
            nativeVoiceFetch,
            'filmVoiceBufs[url] = window.__choreoFetch(url)',
          );
        } else {
          /* Sagrada is mounted as the picture iframe owned by <Film>.
             Its voice and LUT reads must cross both iframe boundaries. */
          experienceSource = experienceSource.replaceAll(
            'fetch(url)',
            'window.__choreoFetch(url)',
          );
          experienceSource = experienceSource.replaceAll(
            'fetch(spec.url)',
            'window.__choreoFetch(spec.url)',
          );
          const childFetchBridge = `<script>
            let nextFetchId = 0;
            const pendingFetches = new Map();
            window.addEventListener('message', (event) => {
              const data = event.data;
              if (event.source !== window.parent || data?.type !== 'choreo:fetch-response') return;
              const pending = pendingFetches.get(data.id);
              if (!pending) return;
              pendingFetches.delete(data.id);
              if (data.error) pending.reject(new Error(data.error));
              else pending.resolve({
                ok: data.status >= 200 && data.status < 300,
                status: data.status,
                arrayBuffer: async () => data.body,
                text: async () => new TextDecoder().decode(data.body),
              });
            });
            window.__choreoFetch = (input) => new Promise((resolve, reject) => {
              const id = ++nextFetchId;
              pendingFetches.set(id, { resolve, reject });
              window.parent.postMessage({ type: 'choreo:fetch-request', id, url: String(input) }, '*');
            });
          </script>`;
          experienceSource = experienceSource.replace(
            /<head(?:\s[^>]*)?>/i,
            (match) => `${match}${childFetchBridge}`,
          );
        }
        const threeURL = new URL(
          asset(`iframe/${name}/three-149.js`),
          document.baseURI,
        );
        /* JavaScript files are normally served as Boxel-transpiled modules.
           This file is deliberately a classic UMD script, so request its raw
           card source; the transpiled response contains `import.meta.loader`
           and cannot run when restored as a classic script in srcdoc. */
        const threeResponse = await request(threeURL, {
          headers: { Accept: 'application/vnd.card+source' },
        });
        if (!threeResponse.ok) {
          throw new Error(`${name} engine returned ${threeResponse.status}`);
        }
        const threeSource = (await threeResponse.text()).replaceAll(
          '</script>',
          '<\\/script>',
        );
        /* Boxel's realm runtime exposes CommonJS-shaped globals while it
           evaluates cards. Three r149's UMD build sees those and otherwise
           publishes onto `exports` instead of `window.THREE`, leaving the
           following Towers script without its expected browser global. Mask
           the loader globals locally so this vendored browser build takes its
           browser branch without changing the surrounding realm runtime. */
        const isolatedThreeSource =
          `(function(module, exports, define) {\n${threeSource}\n}` +
          ').call(window, undefined, undefined, undefined);';
        experienceSource = experienceSource.replace(
          new RegExp(
            `<script\\s+src=["']${name}\\/three-149\\.js["']><\\/script>`,
            'i',
          ),
          `<script>${isolatedThreeSource}</script>`,
        );
        this.experienceName = name;
        this.experienceSource = experienceSource;
      }
      const fetchBridge = `<script>
          let nextFetchId = 0;
          const pendingFetches = new Map();
          const childFetches = new Map();
          window.addEventListener('message', (event) => {
            const data = event.data;
            if (event.source === window.parent && data?.type === 'choreo:fetch-response') {
              const pending = pendingFetches.get(data.id);
              if (pending) {
                pendingFetches.delete(data.id);
                if (data.error) pending.reject(new Error(data.error));
                else pending.resolve({
                  ok: data.status >= 200 && data.status < 300,
                  status: data.status,
                  arrayBuffer: async () => data.body,
                  text: async () => new TextDecoder().decode(data.body),
                });
                return;
              }
              const child = childFetches.get(data.id);
              if (!child) return;
              childFetches.delete(data.id);
              const reply = { ...data, id: child.id };
              child.source.postMessage(reply, '*', data.body ? [data.body] : []);
              return;
            }
            if (event.source !== window.parent && data?.type === 'choreo:fetch-request') {
              const relayId = ++nextFetchId;
              childFetches.set(relayId, { id: data.id, source: event.source });
              window.parent.postMessage({ ...data, id: relayId }, '*');
            }
          });
          window.__choreoFetch = (input) => new Promise((resolve, reject) => {
            const id = ++nextFetchId;
            pendingFetches.set(id, { resolve, reject });
            window.parent.postMessage({ type: 'choreo:fetch-request', id, url: String(input) }, '*');
          });
      </script>`;
      const head = `${base}${fetchBridge}${route}`;
      this.source = /<head(?:\s[^>]*)?>/i.test(html)
        ? html.replace(/<head(?:\s[^>]*)?>/i, (match) => `${match}${head}`)
        : `<head>${head}</head>${html}`;
    } catch (error) {
      if (!this.abort.signal.aborted) {
        this.failed = true;
        console.error('Unable to load isolated Choreo experience', error);
      }
    }
  }

  private deliverExperienceSource = modifier((frame: HTMLIFrameElement) => {
    if (!this.experienceSource || !this.experienceName) {
      return;
    }
    const name = this.experienceName;
    const send = () => {
      frame.contentWindow?.postMessage(
        {
          source: this.experienceSource,
          type: `choreo:${name}-source`,
        },
        '*',
      );
    };
    const requested = (event: MessageEvent) => {
      if (
        event.source === frame.contentWindow &&
        event.data?.type === `choreo:${name}-ready`
      ) {
        send();
      }
    };
    const fetched = async (event: MessageEvent) => {
      if (
        event.source !== frame.contentWindow ||
        event.data?.type !== 'choreo:fetch-request' ||
        typeof event.data.url !== 'string'
      ) {
        return;
      }
      const id = event.data.id;
      try {
        const parsed = new URL(event.data.url, 'https://choreo.invalid/');
        /* `config.rootURL` is the realm's nested `/.../iframe/` mount, so
           Towers sends an absolute URL whose pathname is not rooted at
           `/towers`. Authorise only the final, known asset-shaped suffix;
           the parent still constructs the destination itself below. */
        const tower = parsed.pathname.match(
          /\/towers\/vo\/([a-z0-9-]+\.mp3)$/i,
        );
        const sagrada = parsed.pathname.match(
          /\/sagrada\/(vo\/[a-z0-9-]+\.mp3|luts\/[a-z0-9-]+\.cube)$/i,
        );
        const relative = tower
          ? `towers/vo/${tower[1]}`
          : sagrada
            ? `sagrada/${sagrada[1]}`
            : undefined;
        if (!relative) {
          throw new Error('Blocked iframe fetch outside film assets');
        }
        const url = new URL(asset(`iframe/${relative}`), document.baseURI);
        const response = await fetch(url, {
          credentials: 'same-origin',
          signal: this.abort.signal,
        });
        if (!response.ok) {
          throw new Error(`audio returned ${response.status}`);
        }
        const body = await response.arrayBuffer();
        frame.contentWindow?.postMessage(
          { body, id, status: response.status, type: 'choreo:fetch-response' },
          '*',
          [body],
        );
      } catch (error) {
        frame.contentWindow?.postMessage(
          {
            error: String(error),
            id,
            status: 0,
            type: 'choreo:fetch-response',
          },
          '*',
        );
      }
    };
    frame.addEventListener('load', send);
    window.addEventListener('message', requested);
    window.addEventListener('message', fetched);
    return () => {
      frame.removeEventListener('load', send);
      window.removeEventListener('message', requested);
      window.removeEventListener('message', fetched);
    };
  });

  <template>
    {{#if this.failed}}
      <p class='frame-error' role='alert'>Experience unavailable</p>
    {{else if this.source}}
      <iframe
        title={{@title}}
        sandbox={{this.sandbox}}
        allow="camera 'none'; microphone 'none'; geolocation 'none'"
        referrerpolicy='no-referrer'
        srcdoc={{this.source}}
        {{this.deliverExperienceSource}}
        ...attributes
      ></iframe>
    {{else}}
      <p class='frame-loading' aria-live='polite'>Loading experience…</p>
    {{/if}}
  </template>
}

class ContextualStage extends Component {
  @tracked protected context: 'boot' | 'stage' | 'tile' = 'boot';

  protected place = modifier((el: HTMLElement) => {
    if (this.context !== 'boot') {
      return;
    }
    const face = el.closest('.stage-wrap') ? 'stage' : 'tile';
    requestAnimationFrame(() => {
      if (this.context === 'boot') {
        this.context = face;
      }
    });
  });

  protected get isStage() {
    return this.context === 'stage';
  }
}

/** Lightweight catalog/stage face; the full living world owns its iframe. */
export class SylvaFrameStage extends ContextualStage {
  fullscreen = (event: MouseEvent) => {
    void (event.currentTarget as HTMLElement)
      .closest('.sy-embed')
      ?.querySelector('iframe')
      ?.requestFullscreen();
  };

  <template>
    <div class='sy-face' {{this.place}}>
      {{#if this.isStage}}
        <div class='sy-embed'>
          <RawDocumentFrame
            class='sy-frame'
            @title='Sylva — the living world'
            @route='_sylva'
            {{motion initial=FRAME_FROM animate=FRAME_TO transition=FRAME_IN}}
          />
          <button
            type='button'
            class='sy-theater-btn'
            {{on 'click' this.fullscreen}}
          >⛶ Theater</button>
        </div>
      {{else}}
        <div class='sy-tile'>
          <img
            class='sy-tile-poster'
            src={{asset 'sylva-poster.webp'}}
            alt=''
          />
          <div class='sy-tile-scrim' aria-hidden='true'></div>
          <div class='sy-tile-tour' aria-hidden='true'></div>
          <div class='sy-tile-third' aria-hidden='true'>
            <p class='sy-tile-eyebrow'>A field survey</p>
            <p class='sy-tile-name'>Sylva</p>
            <p class='sy-tile-line'>Step into the living world</p>
          </div>
        </div>
      {{/if}}
    </div>
    {{! @glint-ignore: glimmer-scoped-css attribute }}
    <style scoped>
      .sy-face {
        position: absolute;
        inset: 0;
      }
      .sy-embed {
        position: absolute;
        inset: 0;
        overflow: hidden;
        background: #4a4d44;
        view-transition-name: sylva-stage;
      }
      .sy-frame {
        display: block;
        width: 100%;
        height: 100%;
        border: 0;
        transform-origin: 50% 60%;
      }
      .sy-theater-btn {
        position: absolute;
        top: 14px;
        right: 14px;
        padding: 8px 16px;
        border-radius: 999px;
        border: 1px solid rgba(126, 214, 160, 0.4);
        background: rgba(6, 18, 12, 0.62);
        backdrop-filter: blur(10px);
        color: #cfe9da;
        font:
          11px/1 ui-monospace,
          monospace;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        text-decoration: none;
      }
      .sy-tile {
        position: absolute;
        inset: 0;
        overflow: hidden;
        background: #4a4d44;
      }
      .sy-tile-poster {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
        object-position: 50% 62%;
      }
      .sy-tile-scrim {
        position: absolute;
        inset: 0;
        background:
          radial-gradient(
            60% 50% at 50% 44%,
            rgba(26, 28, 22, 0) 42%,
            rgba(26, 28, 22, 0.3) 100%
          ),
          linear-gradient(rgba(26, 28, 22, 0) 52%, rgba(20, 22, 17, 0.85) 100%);
      }
      .sy-tile-tour {
        position: absolute;
        left: 50%;
        top: 44%;
        width: 92px;
        height: 92px;
        transform: translate(-50%, -50%);
        border-radius: 50%;
        border: 1px solid transparent;
        background:
          linear-gradient(rgba(28, 31, 26, 0.55), rgba(28, 31, 26, 0.55))
            padding-box,
          conic-gradient(
              from 210deg,
              rgba(150, 185, 255, 0.75),
              rgba(255, 205, 150, 0.65),
              rgba(255, 255, 255, 0.22),
              rgba(150, 185, 255, 0.75)
            )
            border-box;
        backdrop-filter: blur(6px);
        transition: transform 200ms ease;
      }
      .sy-tile-tour::before {
        content: '';
        position: absolute;
        inset: -30px;
        border-radius: 50%;
        border: 1px solid rgba(255, 255, 255, 0.28);
      }
      .sy-tile-tour::after {
        content: '';
        position: absolute;
        left: 50%;
        top: 50%;
        transform: translate(-42%, -50%);
        border-style: solid;
        border-width: 11px 0 11px 18px;
        border-color: transparent transparent transparent #fff;
      }
      .sy-tile-tour:hover {
        transform: translate(-50%, -50%) scale(1.06);
      }
      .sy-tile-third {
        position: absolute;
        left: 18px;
        right: 18px;
        bottom: 14px;
      }
      .sy-tile-eyebrow {
        margin: 0 0 4px;
        font:
          500 9px/1 ui-monospace,
          monospace;
        letter-spacing: 0.28em;
        text-transform: uppercase;
        color: #7ed6a0;
      }
      .sy-tile-name {
        margin: 0 0 2px;
        font:
          300 26px/1 ui-sans-serif,
          system-ui,
          sans-serif;
        letter-spacing: 0.3em;
        text-transform: uppercase;
        color: rgba(226, 245, 232, 0.96);
      }
      .sy-tile-line {
        margin: 0;
        font:
          300 13px/1.3 ui-serif,
          Georgia,
          serif;
        color: #9fc2ac;
      }
    </style>
  </template>
}

/** Lightweight catalog/stage face; the complete scored film owns its iframe. */
export class TowersFrameStage extends ContextualStage {
  fullscreen = (event: MouseEvent) => {
    void (event.currentTarget as HTMLElement)
      .closest('.tw-embed')
      ?.querySelector('iframe')
      ?.requestFullscreen();
  };

  <template>
    <div class='tw-face' {{this.place}}>
      {{#if this.isStage}}
        <div class='tw-embed'>
          <RawDocumentFrame
            class='tw-frame'
            @title='Towers — the film'
            @route='_towers'
            {{motion initial=FRAME_FROM animate=FRAME_TO transition=FRAME_IN}}
          />
          <button
            type='button'
            class='tw-theater-btn'
            {{on 'click' this.fullscreen}}
          >⛶ Theater</button>
        </div>
      {{else}}
        <div class='tw-tile'>
          <img
            class='tw-tile-poster'
            src={{asset 'towers-poster.webp'}}
            alt=''
          />
          <div class='tw-tile-scrim' aria-hidden='true'></div>
          <div class='tw-tile-play' aria-hidden='true'></div>
          <div class='tw-tile-third' aria-hidden='true'>
            <p class='tw-tile-eyebrow'>A construction study</p>
            <p class='tw-tile-name'>Towers</p>
            <p class='tw-tile-line'>Not a video — a film cut by a score</p>
          </div>
        </div>
      {{/if}}
    </div>
    {{! @glint-ignore: glimmer-scoped-css attribute }}
    <style scoped>
      .tw-face {
        position: absolute;
        inset: 0;
      }
      .tw-embed {
        position: absolute;
        inset: 0;
        overflow: hidden;
        background: #ecdcbc;
        view-transition-name: tower-stage;
      }
      .tw-frame {
        display: block;
        width: 100%;
        height: 100%;
        border: 0;
        transform-origin: 50% 60%;
      }
      .tw-theater-btn {
        position: absolute;
        top: 14px;
        right: 14px;
        padding: 8px 16px;
        border-radius: 999px;
        border: 1px solid rgba(168, 98, 31, 0.45);
        background: rgba(36, 27, 12, 0.6);
        backdrop-filter: blur(10px);
        color: #f2e9d2;
        font:
          11px/1 ui-monospace,
          monospace;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        text-decoration: none;
      }
      .tw-tile {
        position: absolute;
        inset: 0;
        overflow: hidden;
        background: #b8a074;
      }
      .tw-tile-poster {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        /* the still carries bleed on every side: whatever the tile's
           aspect turns out to be, the keep stays inside the crop */
        object-fit: cover;
        object-position: 54% 52%;
      }
      .tw-tile-scrim {
        position: absolute;
        inset: 0;
        background:
          radial-gradient(
            58% 48% at 50% 44%,
            rgba(46, 30, 16, 0) 44%,
            rgba(46, 30, 16, 0.28) 100%
          ),
          linear-gradient(rgba(46, 30, 16, 0) 50%, rgba(38, 24, 12, 0.86) 100%);
      }
      .tw-tile-play {
        position: absolute;
        left: 50%;
        top: 44%;
        width: 92px;
        height: 92px;
        transform: translate(-50%, -50%);
        border-radius: 50%;
        border: 1px solid transparent;
        background:
          linear-gradient(rgba(44, 30, 16, 0.5), rgba(44, 30, 16, 0.5))
            padding-box,
          conic-gradient(
              from 210deg,
              rgba(255, 214, 158, 0.8),
              rgba(214, 108, 74, 0.7),
              rgba(255, 255, 255, 0.24),
              rgba(255, 214, 158, 0.8)
            )
            border-box;
        backdrop-filter: blur(6px);
        -webkit-backdrop-filter: blur(6px);
        transition: transform 200ms ease;
      }
      .tw-tile-play::before {
        content: '';
        position: absolute;
        inset: -30px;
        border-radius: 50%;
        border: 1px solid rgba(255, 240, 220, 0.26);
      }
      .tw-tile-play::after {
        content: '';
        position: absolute;
        left: 50%;
        top: 50%;
        transform: translate(-42%, -50%);
        border-style: solid;
        border-width: 11px 0 11px 18px;
        border-color: transparent transparent transparent #fff;
      }
      .tw-tile:hover .tw-tile-play {
        transform: translate(-50%, -50%) scale(1.06);
      }
      .tw-tile-third {
        position: absolute;
        left: 18px;
        right: 18px;
        bottom: 14px;
      }
      .tw-tile-eyebrow {
        margin: 0 0 4px;
        font:
          500 9px/1 ui-monospace,
          monospace;
        letter-spacing: 0.28em;
        text-transform: uppercase;
        color: #e8ab6a;
      }
      .tw-tile-name {
        margin: 0 0 2px;
        font:
          300 26px/1 ui-sans-serif,
          system-ui,
          sans-serif;
        letter-spacing: 0.3em;
        text-transform: uppercase;
        color: rgba(252, 240, 224, 0.96);
      }
      .tw-tile-line {
        margin: 0;
        font:
          400 12px/1.3 ui-serif,
          Georgia,
          serif;
        color: rgba(244, 226, 202, 0.78);
      }
    </style>
  </template>
}

/** Draft reference film: intentionally modest tile, complete film in stage. */
export class SagradaFrameStage extends ContextualStage {
  fullscreen = (event: MouseEvent) => {
    void (event.currentTarget as HTMLElement)
      .closest('.sg-embed')
      ?.querySelector('iframe')
      ?.requestFullscreen();
  };

  <template>
    <div class='sg-face' {{this.place}}>
      {{#if this.isStage}}
        <div class='sg-embed'>
          <RawDocumentFrame
            class='sg-frame'
            @title='Sagrada Família — the film'
            @route='_sagrada'
            {{motion initial=FRAME_FROM animate=FRAME_TO transition=FRAME_IN}}
          />
          <button
            type='button'
            class='sg-theater-btn'
            {{on 'click' this.fullscreen}}
          >⛶ Theater</button>
        </div>
      {{else}}
        <div class='sg-tile'>
          <div class='sg-mark' aria-hidden='true'>1882—</div>
          <div class='sg-copy'>
            <p class='sg-eyebrow'>Draft reference film</p>
            <p class='sg-name'>Sagrada Família</p>
            <p class='sg-line'>A construction study</p>
          </div>
        </div>
      {{/if}}
    </div>
    {{! @glint-ignore: glimmer-scoped-css attribute }}
    <style scoped>
      .sg-face,
      .sg-embed {
        position: absolute;
        inset: 0;
      }
      .sg-embed {
        overflow: hidden;
        background: #ecdcbc;
        view-transition-name: sagrada-stage;
      }
      .sg-frame {
        display: block;
        width: 100%;
        height: 100%;
        border: 0;
      }
      .sg-theater-btn {
        position: absolute;
        top: 14px;
        right: 14px;
        padding: 8px 16px;
        border: 1px solid rgba(168, 98, 31, 0.45);
        border-radius: 999px;
        background: rgba(36, 27, 12, 0.62);
        color: #f2e9d2;
        font:
          11px/1 ui-monospace,
          monospace;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }
      .sg-tile {
        position: absolute;
        inset: 0;
        overflow: hidden;
        background:
          linear-gradient(150deg, transparent 52%, rgba(170, 88, 34, 0.18)),
          #ecdcbc;
        color: #2e2515;
      }
      .sg-mark {
        position: absolute;
        top: 15%;
        right: -3%;
        color: rgba(168, 98, 31, 0.16);
        font:
          700 clamp(56px, 9vw, 112px)/1 Archivo,
          sans-serif;
        letter-spacing: -0.08em;
      }
      .sg-copy {
        position: absolute;
        left: 20px;
        right: 20px;
        bottom: 18px;
      }
      .sg-eyebrow,
      .sg-name,
      .sg-line {
        margin: 0;
      }
      .sg-eyebrow {
        margin-bottom: 6px;
        color: #a8621f;
        font:
          600 9px/1 ui-monospace,
          monospace;
        letter-spacing: 0.2em;
        text-transform: uppercase;
      }
      .sg-name {
        font:
          700 23px/1.05 Archivo,
          ui-sans-serif,
          sans-serif;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }
      .sg-line {
        margin-top: 5px;
        color: #74664c;
        font:
          italic 14px/1.2 Georgia,
          serif;
      }
    </style>
  </template>
}
