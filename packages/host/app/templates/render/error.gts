import { service } from '@ember/service';
import Component from '@glimmer/component';

import RouteTemplate from 'ember-route-template';

import type RenderErrorStateService from '../../services/render-error-state';

interface Signature {
  Args: { model?: { reason: string } };
}

class RenderErrorRouteComponent extends Component<Signature> {
  // The render route handles errors before the child route activates, so we read
  // the serialized payload from the shared service instead of relying on params.
  @service declare renderErrorState: RenderErrorStateService;

  get reason() {
    return this.renderErrorState.reason ?? this.args.model?.reason ?? '';
  }

  <template>
    <pre data-prerender-error>
       {{this.reason}}
    </pre>
  </template>
}

export default RouteTemplate(RenderErrorRouteComponent);
