import Component from '@glimmer/component';

import RouteTemplate from 'ember-route-template';

import CardError from '@cardstack/host/components/card-error';
import { ErrorModel as CardRouteErrorModel } from '@cardstack/host/routes/card';

interface CardRouteSignature {
  Args: { model: CardRouteErrorModel };
}

class CardErrorRouteComponent extends Component<CardRouteSignature> {
  <template>
    <CardError
      @type={{@model.loadType}}
      @message={{@model.message}}
      @operatorModeState={{@model.operatorModeState}}
    />
  </template>
}

export default RouteTemplate(CardErrorRouteComponent);
