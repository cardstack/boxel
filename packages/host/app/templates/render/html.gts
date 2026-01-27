import type { TemplateOnlyComponent } from '@ember/component/template-only';

import RouteTemplate from 'ember-route-template';

import type { Model } from '../../routes/render/html';

export default RouteTemplate(
  <template>
    <@model.Component @format={{@model.format}} />
  </template> satisfies TemplateOnlyComponent<{ Args: { model: Model } }>,
);
