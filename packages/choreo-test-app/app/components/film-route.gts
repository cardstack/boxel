import Component from '@glimmer/component';
import { DemoPage } from 'test-app/components/demo-page';
import { findDemo } from 'test-app/lib/catalog';

/**
 * ONE URL, TWO RENDERINGS.
 *
 * `/towers` is the film's page — the same standalone demo page every
 * other demo gets, with the player in a frame where the stage goes.
 * `/towers?embed` is the film ALONE: no nav, no headline, no plate,
 * nothing but the picture and its own transport.
 *
 * The second exists because the first needs something to put in the
 * frame, and the alternative was a second route with an underscore in
 * front of it — a private URL that leaks into the address bar the first
 * time anybody opens the frame on its own. A query on the same address
 * says the truth instead: this is that page, without its page.
 */
export default class FilmRoute extends Component<{
  Args: { id: string };
  Blocks: { film: [] };
}> {
  /** the frame asks for the film by itself */
  get embed(): boolean {
    return /[?&]embed\b/.test(window.location.search);
  }

  get demo() {
    return findDemo(this.args.id);
  }

  <template>
    {{#if this.embed}}
      {{yield to="film"}}
    {{else}}
      <DemoPage @model={{this.demo}} />
    {{/if}}
  </template>
}
