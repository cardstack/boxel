import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import { BoxelButton, CardContainer } from '@cardstack/boxel-ui/components';

import OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import Store from '@cardstack/host/services/store';

import SubmodeLayout from './submode-layout';

interface HostSubmodeSignature {
  Element: HTMLElement;
  Args: {};
}

export default class HostSubmode extends Component<HostSubmodeSignature> {
  @service private declare operatorModeStateService: OperatorModeStateService;
  @service private declare store: Store;

  <template>
    <SubmodeLayout
      class='host-submode-layout'
      data-test-host-submode
      as |layout|
    >
      <div class='host-submode'>
        <CardContainer @displayBoundaries={{true}} class='container'>
          {{#if this.operatorModeStateService.currentRealmInfo.publishable}}
            <p
              data-test-host-submode-card={{this.operatorModeStateService.currentTrailItem}}
            >
              Host submode:
              {{this.operatorModeStateService.currentTrailItem}}
            </p>
          {{else}}
            <p>
              This file is not in a publishable realm.
            </p>
            <BoxelButton
              {{on 'click' (fn layout.updateSubmode 'interact')}}
              data-test-switch-to-interact
            >View in Interact mode</BoxelButton>
          {{/if}}
        </CardContainer>
      </div>
    </SubmodeLayout>

    <style scoped>
      .host-submode {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100%;
        width: 100%;
      }

      .container {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp);
        align-items: center;
        justify-content: center;
        width: 30rem;
        height: 80%;
      }
    </style>
  </template>
}
