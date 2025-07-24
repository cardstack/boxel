import Component from '@glimmer/component';

import { modifier } from 'ember-modifier';
import RouteTemplate from 'ember-route-template';

import CardPrerender from '@cardstack/host/components/card-prerender';
import config from '@cardstack/host/config/environment';

interface ApplicationRouteSignature {
  Args: {};
}

class ApplicationRouteComponent extends Component<ApplicationRouteSignature> {
  get hostMode() {
    if (config.hostModeDomainRoot) {
      let hostModeDomainRoot = config.hostModeDomainRoot;
      let currentHost = window.location.hostname;

      if (currentHost.endsWith(`.${hostModeDomainRoot}`)) {
        return true;
      }
    }

    return false;
  }

  get hostname() {
    return window.location.hostname;
  }

  <template>
    {{#if this.hostMode}}
      <p {{removeLoading}}>Placeholder for host mode: {{this.hostname}}</p>
    {{else}}
      {{! The main application outlet }}
      {{outlet}}
      <CardPrerender />

      {{! this is a signal for the Realm DOM tests to know that app has loaded }}
      {{! template-lint-disable no-inline-styles }}
      <div data-test-boxel-root style='display: none;' {{removeLoading}}></div>
    {{/if}}
  </template>
}

let removeLoading = modifier(() => {
  document.querySelector('#host-loading')?.remove();
});

export default RouteTemplate(ApplicationRouteComponent);
