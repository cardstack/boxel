import type { TemplateOnlyComponent } from '@ember/component/template-only';

import RouteTemplate from 'ember-route-template';

import type { Model } from '../routes/render';

const Render = <template>
  <div
    data-prerender
    data-prerender-id={{@model.cardId}}
    data-prerender-nonce={{@model.nonce}}
    data-prerender-status={{@model.status}}
  >
    {{outlet}}
  </div>
</template> satisfies TemplateOnlyComponent<{ model: Model }>;
export default RouteTemplate(Render);
