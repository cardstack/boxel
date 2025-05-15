import type { TemplateOnlyComponent } from '@ember/component/template-only';

import RouteTemplate from 'ember-route-template';
import { Model } from '../../routes/render/json';

const { stringify } = JSON;

export default RouteTemplate(<template>
  <pre data-render-output='ready'>{{stringify @model.payload}}</pre>
</template> satisfies TemplateOnlyComponent<{ Args: { model: Model } }>);
