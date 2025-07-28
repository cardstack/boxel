import { service } from '@ember/service';
import Component from '@glimmer/component';

import { modifier } from 'ember-modifier';
import RouteTemplate from 'ember-route-template';

import CardPrerender from '@cardstack/host/components/card-prerender';
import HostModeService from '@cardstack/host/services/host-mode-service';

interface ApplicationRouteSignature {
  Args: {};
}

class ApplicationRouteComponent extends Component<ApplicationRouteSignature> {
  @service declare hostModeService: HostModeService;

  get hostname() {
    return window.location.hostname;
  }

  <template>
    {{#if this.hostModeService.isActive}}
      {{outlet}}
      <p {{removeLoading}}>{{! FIXME how to remove without some element }}</p>
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
