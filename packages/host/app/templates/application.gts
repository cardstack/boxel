import type { TemplateOnlyComponent } from '@ember/component/template-only';

import { isTesting } from '@embroider/macros';

import RouteTemplate from 'ember-route-template';

import CardPrerender from '@cardstack/host/components/card-prerender';

interface ApplicationRouteSignature {
  Args: {};
}

const showCardPrerender = isTesting();

const ApplicationRouteComponent: TemplateOnlyComponent<ApplicationRouteSignature> =
  <template>
    {{outlet}}

    {{! this is used to establish a prerenderer for browser-based indexing }}
    {{#if showCardPrerender}}
      <CardPrerender />
    {{/if}}
  </template>;

export default RouteTemplate(ApplicationRouteComponent);
