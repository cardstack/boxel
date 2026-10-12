import type { Join } from '@cardstack/choreo/film';
import { tracked } from '@glimmer/tracking';

/**
 * The message the film's document listens for (`choreo-film-app`'s
 * `JoinPreviews`): `{ type: PREVIEW_JOIN, join }` plays that join over the
 * running picture.
 */
export const PREVIEW_JOIN = 'choreo-film:preview-join';

/**
 * A demo page's line to the film playing in its stage. The film runs in a
 * document of its own, so the page's wall plate cannot call it directly: the
 * frame attaches its window here, and a join previewed here is posted to it.
 *
 * The state belongs to the demo page, which hands it to both the stage and
 * the notes.
 */
export class FilmLink {
  @tracked private film: Window | null = null;

  /**
   * whether a film's frame is attached. That is not whether a preview
   * plays: the film's document has to load, and the viewer has to open
   * the film, before a posted join is heard
   */
  get live(): boolean {
    return this.film !== null;
  }

  /** attach the film's window; the returned function detaches it */
  attach = (film: Window): (() => void) => {
    this.film = film;
    return () => {
      if (this.film === film) {
        this.film = null;
      }
    };
  };

  /** play a join over whatever the film is showing */
  preview = (join: Join) => {
    /* the film's document is a srcdoc frame, so it shares this page's
       origin; nothing is posted to a document from anywhere else */
    this.film?.postMessage({ type: PREVIEW_JOIN, join }, window.origin);
  };
}
