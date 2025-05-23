import Service, { service } from '@ember/service';

import { type Format } from 'https://cardstack.com/base/card-api';

import { SelectedAccordionItem as CodeModePanelSelection } from '../components/operator-mode/code-submode/module-inspector';

import OperatorModeStateService from './operator-mode-state-service';

export default class ContextForAiAssistantService extends Service {
  @service declare private operatorModeStateService: OperatorModeStateService;

  // These properties are set using the ReportUserContextForAiAssistant component
  currentCodeModePanel?: CodeModePanelSelection | undefined;
  playgroundPanelCardId?: string | undefined;
  playgroundPanelFormat?: Format | undefined;

  getContext = () => {
    const submode = this.operatorModeStateService.state.submode;
    const context: {
      submode: string;
      realmUrl: string;
      codeMode?: {
        currentFile: string | undefined;
        currentPanel: CodeModePanelSelection | undefined;
        playgroundPanelCardId: string | undefined;
        playgroundPanelFormat: Format | undefined;
      };
    } = {
      submode,
      realmUrl: this.operatorModeStateService.realmURL.href,
    };

    if (submode === 'code') {
      context.codeMode = {
        currentFile: this.operatorModeStateService.state.codePath?.href,
        currentPanel: this.currentCodeModePanel,
        playgroundPanelCardId: this.playgroundPanelCardId,
        playgroundPanelFormat: this.playgroundPanelFormat,
      };
    }

    return context;
  };
}
