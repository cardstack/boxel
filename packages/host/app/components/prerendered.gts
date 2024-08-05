import { service } from '@ember/service';
import { htmlSafe } from '@ember/template';
import { tracked } from '@glimmer/tracking';
import Component from '@glimmer/component';
import LoaderService from '../services/loader-service';
import { PrerenderedCard } from '@cardstack/runtime-common';

interface PrerenderedCardComponentSignature {
  Element: undefined;
  Args: {
    item: PrerenderedCard;
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
    // cssModuleId is a URL-encoded string with CSS, for example: http://localhost:4201/drafts/person.gts.LnBlcnNvbi1jb250YWluZXIgeyBib3JkZXI6IDFweCBzb2xpZCBncmF5IH0.glimmer-scoped.css
    // these are created by glimmer scoped css and saved as a dependency of an instance in boxel index when the instance is indexed
    for (let cssModuleId of this.args.item.cssModuleIds) {
      await this.loaderService.loader.import(cssModuleId); // This will be intercepted by maybeHandleScopedCSSRequest middleware in the host app which will load the css into the DOM
    }
    this.isCssLoaded = true;

    this.args.onCssLoaded?.();
  }

  <template>
    {{#if this.isCssLoaded}}
      {{htmlSafe @item.html}}
    {{/if}}
  </template>
}
