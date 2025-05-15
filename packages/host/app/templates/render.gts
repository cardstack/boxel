import type { TemplateOnlyComponent } from '@ember/component/template-only';

import RouteTemplate from 'ember-route-template';
import { Model } from '../routes/render';

export default RouteTemplate(<template>
  <@model.Component @format={{@model.format}} data-render-output='ready' />
</template> satisfies TemplateOnlyComponent<{ Args: { model: Model } }>);
