import type { TemplateOnlyComponent } from '@ember/component/template-only';

import RouteTemplate from 'ember-route-template';

import CardError from '@cardstack/host/components/card-error';
import { ErrorModel as CardRouteErrorModel } from '@cardstack/host/routes/card';

interface Signature {
  Args: { model: CardRouteErrorModel };
}

const CardErrorRouteComponent: TemplateOnlyComponent<Signature> = <template>
  <CardError
    @type={{@model.loadType}}
    @message={{@model.message}}
    @operatorModeState={{@model.operatorModeState}}
  />
</template>;

export default RouteTemplate(CardErrorRouteComponent);
