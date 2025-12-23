import type { TemplateOnlyComponent } from '@ember/component/template-only';

import RouteTemplate from 'ember-route-template';

import type { Model } from '../routes/file-meta';

const { stringify } = JSON;

export default RouteTemplate(<template>
  <div
    data-prerender
    data-prerender-id={{@model.id}}
    data-prerender-nonce={{@model.nonce}}
    data-prerender-status={{@model.status}}
  >
    <pre>{{stringify @model.payload null 2}}</pre>
  </div>
</template> satisfies TemplateOnlyComponent<{ Args: { model: Model } }>);
