import type { TemplateOnlyComponent } from '@ember/component/template-only';

import RouteTemplate from 'ember-route-template';

import type { Model } from '../../routes/render/icon';

export default RouteTemplate(<template>
  <@model.Component />
</template> satisfies TemplateOnlyComponent<{
  Args: { model: Model };
}>);
