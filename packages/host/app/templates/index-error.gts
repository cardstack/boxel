import type { TemplateOnlyComponent } from '@ember/component/template-only';

import RouteTemplate from 'ember-route-template';

import CardError from '@cardstack/host/components/card-error';
import { ErrorModel as IndexRouteErrorModel } from '@cardstack/host/routes/index';

interface Signature {
  Args: { model: IndexRouteErrorModel };
}

const IndexErrorRouteComponent: TemplateOnlyComponent<Signature> = <template>
  <CardError
    @type={{@model.loadType}}
    @message={{@model.message}}
    @operatorModeState={{@model.operatorModeState}}
  />
</template>;

export default RouteTemplate(IndexErrorRouteComponent);
