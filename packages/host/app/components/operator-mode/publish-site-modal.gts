import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import Component from '@glimmer/component';
import { service } from '@ember/service';

import { BoxelButton, RealmIcon } from '@cardstack/boxel-ui/components';
import { not } from '@cardstack/boxel-ui/helpers';

import ModalContainer from '../modal-container';
import WithLoadedRealm from '../with-loaded-realm';

import type RealmService from '../../services/realm';
import type OperatorModeStateService from '../../services/operator-mode-state-service';

interface Signature {
  Element: HTMLElement;
  Args: {
    isOpen: boolean;
    onClose: () => void;
  };
}

export default class PublishSiteModal extends Component<Signature> {
  @service private declare realm: RealmService;
  @service private declare operatorModeStateService: OperatorModeStateService;

  @tracked selectedDomains: string[] = [];
  @tracked publishSuccess = false;

  get isDefaultDomainSelected() {
    return this.selectedDomains.includes('default-domain');
  }

  get currentRealmUrl() {
    return this.operatorModeStateService.currentRealmInfo?.url || '';
  }

  get generatedUrl() {
    // This will be replaced with actual URL generation logic
    return 'https://your-realm.boxel.space';
  }

  @action
  toggleDefaultDomain() {
    if (this.isDefaultDomainSelected) {
      this.selectedDomains = this.selectedDomains.filter(
        (domain) => domain !== 'default-domain',
      );
    } else {
      this.selectedDomains = [...this.selectedDomains, 'default-domain'];
    }
  }

  @action
  handlePublish() {
    this.publishSuccess = true;
  }

  @action
  handleOpenSite() {
    window.open(this.generatedUrl, '_blank');
  }

  @action
  handleCancel() {
    this.args.onClose();
  }

  <template>
    <ModalContainer
      class='publish-site-modal'
      @cardContainerClass='publish-site'
      @title='Where to?'
      @size='medium'
      @isOpen={{@isOpen}}
      @onClose={{this.handleCancel}}
      data-test-publish-site-modal
    >
      <:header>
        <div class='modal-subtitle'>
          Choose which domains you'd like to publish to
        </div>
      </:header>
      <:content>

        <div class='domain-options'>
          <div class='domain-option'>
            <div class='domain-header'>
              <input
                type='checkbox'
                checked={{this.isDefaultDomainSelected}}
                {{on 'change' this.toggleDefaultDomain}}
                class='domain-checkbox'
                data-test-default-domain-checkbox
              />
              <span class='domain-name'>Your Boxel Space</span>
            </div>

            <div class='domain-details'>
              <WithLoadedRealm @realmURL={{this.currentRealmUrl}} as |realm|>
                <RealmIcon @realmInfo={{realm.info}} class='realm-icon' />
              </WithLoadedRealm>
              <span class='generated-url'>{{this.generatedUrl}}</span>
              {{#if this.publishSuccess}}
                <BoxelButton
                  @kind='secondary-light'
                  @size='small'
                  {{on 'click' this.handleOpenSite}}
                  class='open-site-button'
                  data-test-open-site-button
                >
                  Open Site
                </BoxelButton>
              {{/if}}
            </div>
          </div>
        </div>
      </:content>

      <:footer>
        {{#if @isOpen}}
          <div class='footer-buttons'>
            <BoxelButton
              @kind='secondary-light'
              @size='tall'
              {{on 'click' this.handleCancel}}
              class='cancel-button'
              data-test-cancel-button
            >
              Cancel
            </BoxelButton>
            <BoxelButton
              @kind='primary'
              @size='tall'
              {{on 'click' this.handlePublish}}
              @disabled={{not this.isDefaultDomainSelected}}
              class='publish-button'
              data-test-publish-button
            >
              Publish to selected domains
            </BoxelButton>
          </div>
        {{/if}}
      </:footer>
    </ModalContainer>

    <style scoped>
      .publish-site-modal {
        --horizontal-gap: var(--boxel-sp-xs);
        --stack-card-footer-height: auto;
      }

      .publish-site-modal > :deep(.boxel-modal__inner) {
        display: flex;
      }

      .publish-site-modal :deep(.dialog-box__content) {
        display: flex;
        flex-direction: column;
      }

      :deep(.publish-site) {
        height: 32rem;
      }

      :deep(.dialog-box__header) {
        gap: var(--boxel-sp-xxxs);
      }

      :deep(.dialog-box__close) {
        display: none;
      }

      .modal-subtitle {
        font-size: normal var(--boxel-font-sm);
        color: var(--boxel-dark);
      }

      .domain-options {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-lg);
      }

      .domain-option {
        border: 1px solid var(--boxel-300);
        border-radius: var(--boxel-border-radius);
        padding: var(--boxel-sp-lg);
        background-color: var(--boxel-50);
      }

      .domain-header {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-sm);
        margin-bottom: var(--boxel-sp-md);
      }

      .domain-checkbox {
        flex-shrink: 0;
      }

      .domain-name {
        font-size: var(--boxel-font-size-md);
        font-weight: 500;
        color: var(--boxel-dark);
      }

      .domain-details {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-sm);
        padding-left: calc(var(--boxel-sp-lg) + var(--boxel-sp-sm));
      }

      .realm-icon {
        flex-shrink: 0;
        --boxel-realm-icon-size: 30px;
      }

      .generated-url {
        flex: 1;
        font-size: var(--boxel-font-size-sm);
        color: var(--boxel-600);
        font-family: var(--boxel-font-family-mono);
        background-color: var(--boxel-100);
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        border-radius: var(--boxel-border-radius-sm);
        border: 1px solid var(--boxel-200);
      }

      .open-site-button {
        flex-shrink: 0;
      }

      .footer-buttons {
        display: flex;
        margin-left: auto;
        gap: var(--horizontal-gap);
      }
    </style>
  </template>
}
