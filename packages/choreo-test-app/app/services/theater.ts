import Service from '@ember/service';
import { tracked } from '@glimmer/tracking';

/**
 * THEATER MODE — the film full height at the front of its own page.
 *
 * A film's page is an ordinary demo page: a headline, the player in a
 * frame, the code, the cutting room. Theater is that same page with the
 * player brought to the front and given the whole window, and it is a
 * MODE rather than a second route because the film must not restart
 * when you enter it. That is also why the player never moves in the
 * DOM: re-parenting an iframe reloads it, so the stage stays where it
 * is and the page re-orders around it.
 *
 * The state lives in `#theater`, so it can be linked to
 * (`/choreo/towers#theater`) and so the back button means something.
 * Ember's router does not route on the hash, so this service owns it:
 * it reads the hash at boot, writes it on every change, and follows the
 * browser's own back and forward.
 */
export default class TheaterService extends Service {
  @tracked on = false;

  private listening = false;

  /** read `#theater` off the URL and start following the history */
  attach() {
    if (this.listening) {
      return;
    }
    this.listening = true;
    this.on = this.hashSaysOn();
    window.addEventListener('hashchange', this.follow);
  }

  detach() {
    if (!this.listening) {
      return;
    }
    this.listening = false;
    window.removeEventListener('hashchange', this.follow);
    this.on = false;
  }

  private hashSaysOn(): boolean {
    return window.location.hash.replace(/^#/, '') === 'theater';
  }

  private follow = () => {
    this.on = this.hashSaysOn();
  };

  /**
   * Enter or leave. The hash is PUSHED rather than replaced, so the back
   * button leaves theater instead of leaving the page — someone who
   * pressed a button expects the browser's own undo to undo that button.
   */
  toggle = () => {
    this.enter(!this.on);
  };

  /* not `set`: that name is Ember's classic object method */
  enter(on: boolean) {
    this.on = on;
    const url = new URL(window.location.href);
    url.hash = on ? 'theater' : '';
    const href = on ? url.href : url.href.replace(/#$/, '');
    window.history.pushState(null, '', href);
  }
}

declare module '@ember/service' {
  interface Registry {
    theater: TheaterService;
  }
}
