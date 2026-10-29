import { service } from '@ember/service';
import Component from '@glimmer/component';

import { AnswerFooter as KitAnswerFooter } from '@cardstack/pretui/components/answer-footer';

import { rri } from '@cardstack/runtime-common';

import { Submodes } from '@cardstack/host/components/submode-switcher';

import type { AnswerFooterData } from '@cardstack/host/lib/turn-summary';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

interface Signature {
  Args: { footer: AnswerFooterData };
  Element: HTMLDivElement;
}

// The quiet actions under a turn's final reply, as Pret UI's AnswerFooter
// draws them: copy, keep it as a card, what it changed, ask again, and what
// the turn cost. It has no Review: the host has no view that reviews a turn's
// changes. The host supplies what each action does.
export default class AnswerFooter extends Component<Signature> {
  @service declare private operatorModeStateService: OperatorModeStateService;

  private savedUrl: string | undefined;

  // keeps the reply as a card and gives the kit the saved card's name
  private save = async () => {
    let save = this.args.footer.saveAsCard;
    if (!save) {
      return;
    }
    this.savedUrl = await save();
    return decodeURIComponent(this.savedUrl.split('/').pop() ?? '');
  };

  private openSaved = () => {
    if (!this.savedUrl) {
      return;
    }
    if (this.operatorModeStateService.workspaceChooserOpened) {
      this.operatorModeStateService.closeWorkspaceChooser();
    }
    this.operatorModeStateService.updateSubmode(Submodes.Code);
    this.operatorModeStateService.updateCodePath(rri(this.savedUrl));
  };

  // The turn's changes list above the footer already says what changed,
  // file by file: the footer doesn't say it a second time.
  private get diff() {
    let diff = this.args.footer.diff;
    return diff && !diff.perFile?.length
      ? { files: diff.files, added: diff.added, removed: diff.removed }
      : undefined;
  }

  <template>
    <KitAnswerFooter
      @text={{@footer.markdown}}
      @onSave={{if @footer.saveAsCard this.save}}
      @onOpenSaved={{this.openSaved}}
      @diff={{this.diff}}
      @onRetry={{@footer.retry}}
      @cost={{@footer.credits}}
      data-test-answer-footer
      ...attributes
    />
  </template>
}
