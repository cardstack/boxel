import { registerDestructor } from '@ember/destroyable';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';
import { motion } from 'glimmer-motion';

import { realmFile } from '../lib/realm-url';

/** where the film app's build lives in this realm (see choreo-film-app) */
const FILM_APP = realmFile('film-app/');

/** what the film app posts once its first frame is up (its lib/first-frame) */
const FIRST_FRAME = 'choreo-film:first-frame';

/* a film that never says so still comes up, this long after its document
   has loaded: the poster must not stand in front of a running film forever */
const FIRST_FRAME_DEADLINE_MS = 8000;

const FRAME_HIDDEN = { opacity: 0 } as const;
const FRAME_SHOWN = { opacity: 1 } as const;
const FRAME_IN = { duration: 0.5, ease: [0.22, 1, 0.36, 1] } as const;

export type FilmName = 'sagrada' | 'sylva' | 'towers';

interface Signature {
  Args: {
    film: FilmName;
    /** the frame's accessible name */
    title: string;
  };
  Element: HTMLIFrameElement;
}

/**
 * One of the films, playing in a frame of its own.
 *
 * A film is a three.js world, a shader post pass and per-beat audio, so it
 * runs in its own document, built by `choreo-film-app` into `film-app/`, and
 * unmounts whole with the frame. The realm serves an `.html` file navigated
 * to in a frame as the host's file viewer rather than as the page, so the
 * app's page is fetched as card source and mounted through `srcdoc`, with a
 * `<base>` at the app's directory so its scripts and media resolve against
 * the realm. The root element names the film the app plays.
 *
 * The frame stays transparent until the film posts that its first frame is
 * up: whatever the frame sits on — the film's poster, in `FilmStage` — is
 * what shows while the world loads, and the film fades in over a still of
 * itself.
 *
 * The film's own requests carry no realm session. Where the host's auth
 * service worker controls the frame it adds one, but a browser that leaves
 * `srcdoc` documents uncontrolled (Firefox) sends them bare, so from a realm
 * that is not publicly readable the film cannot load its scripts. That case
 * is named in the frame rather than left as a blank one.
 */
export class FilmFrame extends Component<Signature> {
  @tracked source?: string;
  @tracked error?: string;
  /** the film has posted its first frame (or run out of time to) */
  @tracked shown = false;
  private publicReadable = false;
  private frameEl?: HTMLIFrameElement;
  private deadline?: ReturnType<typeof setTimeout>;
  private abort = new AbortController();

  constructor(owner: unknown, args: Signature['Args']) {
    super(owner as never, args);
    window.addEventListener('message', this.onMessage);
    registerDestructor(this, () => {
      this.abort.abort();
      window.removeEventListener('message', this.onMessage);
      clearTimeout(this.deadline);
    });
    void this.load();
  }

  private async load() {
    try {
      let response = await fetch(`${FILM_APP}index.html`, {
        signal: this.abort.signal,
        headers: { Accept: 'application/vnd.card+source' },
      });
      if (!response.ok) {
        throw new Error(`film-app/index.html: ${response.status}`);
      }
      this.publicReadable =
        response.headers.get('x-boxel-realm-public-readable') === 'true';
      let html = await response.text();
      this.source = html
        .replace(/<html(?=[\s>])/i, `<html data-film="${this.args.film}"`)
        .replace(
          /<head[^>]*>/i,
          (head) =>
            `${head}<base href="${FILM_APP.replaceAll('"', '&quot;')}">`,
        );
    } catch (error) {
      if (!this.abort.signal.aborted) {
        this.error = String(error);
      }
    }
  }

  private frame = modifier((element: HTMLIFrameElement) => {
    this.frameEl = element;
    return () => {
      if (this.frameEl === element) {
        this.frameEl = undefined;
      }
    };
  });

  private onMessage = (event: MessageEvent) => {
    if (
      event.source &&
      event.source === this.frameEl?.contentWindow &&
      (event.data as { type?: unknown } | null)?.type === FIRST_FRAME
    ) {
      this.show();
    }
  };

  private onLoad = () => {
    if (!this.publicReadable && !this.controlled()) {
      this.error =
        'this browser loads a film without your realm session, so it plays here only from a publicly readable realm';
      this.source = undefined;
      return;
    }
    clearTimeout(this.deadline);
    this.deadline = setTimeout(() => this.show(), FIRST_FRAME_DEADLINE_MS);
  };

  /** whether the host's auth service worker is handling the film's requests */
  private controlled(): boolean {
    try {
      return Boolean(
        this.frameEl?.contentWindow?.navigator.serviceWorker?.controller,
      );
    } catch {
      return false;
    }
  }

  private show() {
    clearTimeout(this.deadline);
    if (!this.shown) {
      this.shown = true;
    }
  }

  get pose() {
    return this.shown ? FRAME_SHOWN : FRAME_HIDDEN;
  }

  <template>
    {{#if this.source}}
      <iframe
        title={{@title}}
        srcdoc={{this.source}}
        sandbox='allow-scripts allow-same-origin allow-pointer-lock'
        allow='autoplay; fullscreen'
        allowfullscreen
        data-film-shown={{this.shown}}
        {{this.frame}}
        {{on 'load' this.onLoad}}
        {{motion initial=FRAME_HIDDEN animate=this.pose transition=FRAME_IN}}
        ...attributes
      ></iframe>
    {{else if this.error}}
      <p class='film-status' role='alert'>Unable to load the film:
        {{this.error}}</p>
    {{/if}}
    <style scoped>
      .film-status {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        margin: 0;
        padding: 16px;
        font-family: var(--font-mono);
        font-size: 11px;
        letter-spacing: 0.14em;
        text-align: center;
        text-transform: uppercase;
        color: rgba(255, 250, 242, 0.92);
        background: rgba(14, 12, 10, 0.72);
      }
    </style>
  </template>
}
