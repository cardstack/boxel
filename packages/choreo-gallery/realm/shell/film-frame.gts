import { registerDestructor } from '@ember/destroyable';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { motion } from 'glimmer-motion';

import { realmFile } from '../lib/realm-url';

/** where the film app's build lives in this realm (see choreo-film-app) */
const FILM_APP = realmFile('film-app/');

const FRAME_FROM = { opacity: 0, scale: 0.97 } as const;
const FRAME_TO = { opacity: 1, scale: 1 } as const;
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
 */
export class FilmFrame extends Component<Signature> {
  @tracked source?: string;
  @tracked error?: string;
  private abort = new AbortController();

  constructor(owner: unknown, args: Signature['Args']) {
    super(owner as never, args);
    registerDestructor(this, () => this.abort.abort());
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

  <template>
    {{#if this.source}}
      <iframe
        title={{@title}}
        srcdoc={{this.source}}
        sandbox='allow-scripts allow-same-origin allow-pointer-lock'
        allow='autoplay; fullscreen'
        allowfullscreen
        {{motion initial=FRAME_FROM animate=FRAME_TO transition=FRAME_IN}}
        ...attributes
      ></iframe>
    {{else if this.error}}
      <p class='film-status' role='alert'>Unable to load the film:
        {{this.error}}</p>
    {{else}}
      <p class='film-status' role='status'>Loading the film…</p>
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
        text-transform: uppercase;
        color: rgba(255, 250, 242, 0.8);
      }
    </style>
  </template>
}
