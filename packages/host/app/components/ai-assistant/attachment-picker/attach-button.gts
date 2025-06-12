import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';

import { restartableTask } from 'ember-concurrency';

import { AddButton } from '@cardstack/boxel-ui/components';
import { cn, eq } from '@cardstack/boxel-ui/helpers';

import { chooseCard, baseCardRef, chooseFile } from '@cardstack/runtime-common';

import { type CardDef } from 'https://cardstack.com/base/card-api';
import { type FileDef } from 'https://cardstack.com/base/file-api';

import { Submode } from '../../submode-switcher';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    submode: Submode;
    files: FileDef[];
    cards: CardDef[];
    chooseCard: (cardId: string) => void;
    chooseFile: (file: FileDef) => void;
    width?: string;
    height?: string;
  };
}

export default class AttachButton extends Component<Signature> {
  <template>
    {{#if (eq @submode 'code')}}
      <AddButton
        class={{cn 'attach-button'}}
        @variant='pill'
        @iconWidth={{unless @width '14'}}
        @iconHeight={{unless @height '14'}}
        {{on 'click' this.chooseFile}}
        @disabled={{this.doChooseFile.isRunning}}
        data-test-choose-file-btn
      />
    {{else}}
      <AddButton
        class={{cn 'attach-button'}}
        @variant='pill'
        @iconWidth={{unless @width '14'}}
        @iconHeight={{unless @height '14'}}
        {{on 'click' this.chooseCard}}
        @disabled={{this.chooseCardTask.isRunning}}
        data-test-choose-card-btn
      />
    {{/if}}
    <style scoped>
      .attach-button {
        height: 30px;
        padding: 0;
        gap: var(--boxel-sp-xs);
        background: none;
      }
      .attach-button:hover:not(:disabled),
      .attach-button:focus:not(:disabled) {
        --icon-color: var(--boxel-600);
        color: var(--boxel-600);
        background: none;
        box-shadow: none;
      }
      .attach-button > :deep(svg > path) {
        stroke: none;
      }
    </style>
  </template>

  @action
  private chooseCard() {
    this.chooseCardTask.perform();
  }

  private chooseCardTask = restartableTask(async () => {
    let cardId = await chooseCard({
      filter: { type: baseCardRef },
    });
    if (cardId) {
      this.args.chooseCard(cardId);
    }
  });

  @action
  private async chooseFile() {
    let file = await this.doChooseFile.perform();
    if (file) {
      this.args.chooseFile(file);
    }
  }

  private doChooseFile = restartableTask(async () => {
    let chosenFile: FileDef | undefined = await chooseFile();
    return chosenFile;
  });
}
