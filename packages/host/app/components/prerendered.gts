import { service } from '@ember/service';
import { htmlSafe } from '@ember/template';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import LoaderService from '../services/loader-service';
import { PrerenderedCard } from '@cardstack/runtime-common';

interface PrerenderedCardComponentSignature {
  Element: undefined;
  Args: {
    card: PrerenderedCard;
    onCssLoaded?: () => void;
  };
}

export default class PrerenderedCardComponent extends Component<PrerenderedCardComponentSignature> {
  @service declare loaderService: LoaderService;

  constructor(
    owner: unknown,
    props: PrerenderedCardComponentSignature['Args'],
  ) {
    super(owner, props);

    this.ensureCssLoaded();
  }

  @tracked isCssLoaded = false;

  async ensureCssLoaded() {
    // cssModuleUrl is a URL-encoded string with CSS, for example: http://localhost:4201/drafts/person.gts.LnBlcnNvbi1jb250YWluZXIgeyBib3JkZXI6IDFweCBzb2xpZCBncmF5IH0.glimmer-scoped.css
    // These are created by glimmer scoped css and saved as a dependency of an instance in boxel index when the instance is indexed
    for (let cssModuleUrl of this.args.card.cssModuleUrls) {
      await this.loaderService.loader.import(cssModuleUrl); // This will be intercepted by maybeHandleScopedCSSRequest middleware in the host app which will load the css into the DOM
    }
    this.isCssLoaded = true;

    this.args.onCssLoaded?.();
  }

  <template>
    {{#if this.isCssLoaded}}
      {{htmlSafe @card.html}}
    {{/if}}
  </template>
}
