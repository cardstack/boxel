import Component from '@glimmer/component';

import RouteTemplate from 'ember-route-template';

import CardPrerender from '@cardstack/host/components/card-prerender';

interface ApplicationRouteSignature {
  Args: {};
}

class ApplicationRouteComponent extends Component<ApplicationRouteSignature> {
  <template>
    {{outlet}}
    <CardPrerender />
    <div data-test-boxel-root style='display: none;'></div>
  </template>
}

export default RouteTemplate(ApplicationRouteComponent);
