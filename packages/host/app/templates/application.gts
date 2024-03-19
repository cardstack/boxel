import Component from '@glimmer/component';

import BasicDropdownWormhole from 'ember-basic-dropdown/components/basic-dropdown-wormhole';
import RouteTemplate from 'ember-route-template';

import CardPrerender from '@cardstack/host/components/card-prerender';

interface ApplicationRouteSignature {
  Args: {};
}

class ApplicationRouteComponent extends Component<ApplicationRouteSignature> {
  <template>
    {{outlet}}
    <CardPrerender />
    <BasicDropdownWormhole />

    {{! this is a signal for the Realm DOM tests to know that app has loaded }}
    {{! template-lint-disable no-inline-styles }}
    <div data-test-boxel-root style='display: none;'></div>
  </template>
}

export default RouteTemplate(ApplicationRouteComponent);
