import type { TemplateOnlyComponent } from '@ember/component/template-only';

import RouteTemplate from 'ember-route-template';
import { Model } from '../../routes/render/icon';

export default RouteTemplate(
  <template>
    <@model.Component data-render-output="ready" />
  </template> satisfies TemplateOnlyComponent<{
    Args: { model: Model };
  }>,
);
