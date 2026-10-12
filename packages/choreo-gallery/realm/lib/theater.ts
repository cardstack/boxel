import { tracked } from '@glimmer/tracking';

/**
 * Theater mode: a film's page with its stage brought to the front and given
 * the window's height. It is a mode of the page rather than a page of its own
 * because the film must not restart when you enter it, so the stage never
 * moves in the DOM (re-parenting an iframe reloads it); the page re-orders
 * around it instead.
 *
 * The state belongs to whoever renders the page: the gallery card, or a demo
 * card opened on its own. It is never written to the host's URL.
 */
export class Theater {
  @tracked on = false;

  enter = (on: boolean) => {
    this.on = on;
  };

  toggle = () => {
    this.on = !this.on;
  };
}
