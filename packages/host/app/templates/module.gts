import type { TemplateOnlyComponent } from '@ember/component/template-only';

import ModuleTemplate from 'ember-route-template';

import type { Model } from '../routes/module';

const { stringify } = JSON;

export default ModuleTemplate(
  <template>
    <div
      data-prerender-module
      data-prerender-module-id={{@model.id}}
      data-prerender-module-nonce={{@model.nonce}}
      data-prerender-module-status={{@model.status}}
    >
      <pre>{{stringify @model null 2}}</pre>
    </div>
  </template> satisfies TemplateOnlyComponent<{ Args: { model: Model } }>,
);
