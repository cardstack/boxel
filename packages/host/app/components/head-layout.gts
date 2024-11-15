import { inject as service } from '@ember/service';

import Component from '@glimmer/component';

import type OperatorModeStateService from '../services/operator-mode-state-service';

import type { SimpleDocument } from '@simple-dom/interface';

export default class HeadLayout extends Component {
  @service('-document') private document!: SimpleDocument;
  private headElement = this.document.head as unknown as Element;

  <template>
    {{#in-element this.headElement insertBefore=null}}
      {{! template-lint-disable no-forbidden-elements }}
      <meta name='ember-cli-head-start' content='' />
      <HeadComponent />
      <meta name='ember-cli-head-end' content='' />
    {{/in-element}}
  </template>
}

class HeadComponent extends Component {
  @service private declare operatorModeStateService: OperatorModeStateService;
  <template>
    <title>{{this.operatorModeStateService.title}}</title>
  </template>
}
