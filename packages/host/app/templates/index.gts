import MatrixService from '@cardstack/host/services/matrix-service';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import RouteTemplate from 'ember-route-template';
import Auth from '@cardstack/host/components/matrix/auth';
import WorkspaceChooser from '@cardstack/host/components/operator-mode/workspace-chooser';
import OperatorModeContainer from '../components/operator-mode/container';

let noop = () => {};
class IndexComponent extends Component<void> {
  @service private declare matrixService: MatrixService;
  <template>
    <div>
      {{!-- {{#if this.matrixService.isLoggedIn}}
        <WorkspaceChooser />
      {{else}}
        <Auth />
      {{/if}} --}}

      <OperatorModeContainer @onClose={{noop}} />
    </div>
  </template>
}

export default RouteTemplate(IndexComponent);
