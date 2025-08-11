import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { inject as service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import RouteTemplate from 'ember-route-template';
import window from 'ember-window-mock';

import { eq } from '@cardstack/boxel-ui/helpers';

import type MatrixService from '@cardstack/host/services/matrix-service';

interface ConnectComponentSignature {
  Args: {};
}

class ConnectComponent extends Component<ConnectComponentSignature> {
  @service private declare matrixService: MatrixService;

  @tracked storageAccess: boolean | undefined = undefined;

  constructor(owner: unknown, args: ConnectComponentSignature['Args']) {
    super(owner, args);
    this.storeAccessPermissions();
  }

  @action
  async storeAccessPermissions() {
    this.storageAccess = await window.document.hasStorageAccess();
    console.log('storage access response', this.storageAccess);
  }

  @action
  async requestPermission() {
    await window.document
      .requestStorageAccess()
      .then(async () => {
        this.storeAccessPermissions();
      })
      .catch((error) => {
        console.error('Failed to request storage access:', error);
      });
  }

  <template>
    {{#if this.storageAccess}}
      {{#if this.matrixService.isLoggedIn}}
        Logged in as
        {{this.matrixService.userId}}
      {{else}}
        <button class='connect' {{on 'click' this.requestPermission}}>
          Request storage permission
        </button>
      {{/if}}
    {{else}}
      <p>FIXME what to do?</p>
    {{/if}}
  </template>
}

export default RouteTemplate(ConnectComponent);
