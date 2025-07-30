import { TemplateOnlyComponent } from '@ember/component/template-only';

import RouteTemplate from 'ember-route-template';

import { Model } from '../routes/render';

const Render = <template>
  <div
    data-prerender
    data-prerender-status={{if @model.ready 'ready' 'loading'}}
  >
    {{outlet}}
  </div>
</template> satisfies TemplateOnlyComponent<{ model: Model }>;
export default RouteTemplate(Render);
