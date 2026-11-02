import Component from '@glimmer/component';
import { consume } from 'ember-provide-consume-context';

import { CardContextName } from '@cardstack/runtime-common';

import type { CardContext } from './card-api';

// Where a site's frame card places the page. A site names one frame card in
// its settings; every page of the site is shown inside it, so the header,
// navigation and footer stay put while the page changes.
//
//   <header>…</header>
//   <SitePage class='page' />
//   <footer>…</footer>
//
// On a published site the host fills it with the page being shown. Anywhere
// else (the frame's own prerender, the app) it renders an empty marker,
// which the server fills with the page's prerendered HTML so the first paint
// already has the page inside its frame.

interface Signature {
  Element: HTMLElement;
}

export class SitePage extends Component<Signature> {
  @consume(CardContextName) declare cardContext: CardContext | undefined;

  get outlet() {
    return this.cardContext?.sitePage;
  }

  <template>
    {{#if this.outlet}}
      <this.outlet ...attributes />
    {{else}}
      <div data-boxel-site-page ...attributes></div>
    {{/if}}
  </template>
}

export default SitePage;
