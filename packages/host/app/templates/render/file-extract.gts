import type { TemplateOnlyComponent } from '@ember/component/template-only';

import RouteTemplate from 'ember-route-template';

import type { Model } from '../../routes/render/file-extract';

const { stringify } = JSON;

export default RouteTemplate(
  <template>
    <div
      data-prerender-file-extract
      data-prerender-file-extract-id={{@model.id}}
      data-prerender-file-extract-nonce={{@model.nonce}}
      data-prerender-file-extract-status={{@model.status}}
    >
      <pre>{{stringify @model null 2}}</pre>
    </div>
  </template> satisfies TemplateOnlyComponent<{ Args: { model: Model } }>,
);
