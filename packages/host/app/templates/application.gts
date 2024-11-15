import type { TemplateOnlyComponent } from '@ember/component/template-only';

import { modifier } from 'ember-modifier';
import RouteTemplate from 'ember-route-template';

import CardPrerender from '@cardstack/host/components/card-prerender';

import HeadLayout from '../components/head-layout';

interface ApplicationRouteSignature {
  Args: {};
}

const ApplicationRouteComponent: TemplateOnlyComponent<ApplicationRouteSignature> =
  <template>
    <HeadLayout />
    {{outlet}}
    <CardPrerender />

    {{! this is a signal for the Realm DOM tests to know that app has loaded }}
    {{! template-lint-disable no-inline-styles }}
    <div data-test-boxel-root style='display: none;' {{removeLoading}}></div>
  </template>;

let removeLoading = modifier(() => {
  document.querySelector('#host-loading')?.remove();
});

export default RouteTemplate(ApplicationRouteComponent);
