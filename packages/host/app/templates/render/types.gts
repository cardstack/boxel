import type { TemplateOnlyComponent } from '@ember/component/template-only';

import RouteTemplate from 'ember-route-template';

import type { Model } from '../../routes/render/types';

const { stringify } = JSON;

export default RouteTemplate(
  <template>
    <pre>{{stringify @model null 2}}</pre>
  </template> satisfies TemplateOnlyComponent<{ Args: { model: Model } }>,
);
