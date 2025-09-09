import type { TemplateOnlyComponent } from '@ember/component/template-only';

import RouteTemplate from 'ember-route-template';

export default RouteTemplate(<template>
  <pre
    data-prerender
    data-prerender-status='error'
  >
     {{@model.reason}}
  </pre>
</template> satisfies TemplateOnlyComponent<{
  Args: { model: { reason: string } };
}>);
