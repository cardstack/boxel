import Component from '@glimmer/component';
import { service } from '@ember/service';
import type CardService from '@cardstack/host/services/card-service';
import type CodeService from '@cardstack/host/services/code-service';
import type CodeController from '@cardstack/host/controllers/code';
import { card } from '@cardstack/host/resources/card';
import { file } from '@cardstack/host/resources/file';
import { maybe } from '@cardstack/host/resources/maybe';
import { RealmPaths } from '@cardstack/runtime-common/paths';
import { isCardResource } from '@cardstack/runtime-common';
import { inject as controller } from '@ember/controller';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { action } from '@ember/object';
import { eq } from '@cardstack/boxel-ui/helpers/truth-helpers';

interface Args {
  Args: {};
}

export default class RecentFiles extends Component<Args> {
  @service declare cardService: CardService;
  @service declare codeService: CodeService;
  @controller declare code: CodeController;

  @action
  openFile(entryPath: string) {
    this.code.openFile(entryPath);
  }

  <template>
    <ul data-test-recent-files>
      {{#each this.codeService.recentFiles as |file|}}
        {{#unless (eq file this.code.path)}}
          <li
            data-test-recent-file={{file}}
            role='button'
            {{on 'click' (fn this.openFile file)}}
          >
            <FileLink @file={{file}} />
          </li>
        {{/unless}}
      {{/each}}
    </ul>
  </template>
}

interface FileArgs {
  Args: {
    file: string;
  };
}

class FileLink extends Component<FileArgs> {
  <template>
    <span>
      {{this.title}}
    </span>
  </template>

  @service declare cardService: CardService;

  file = maybe(this, (context) => {
    const relativePath = this.args.file;
    if (relativePath) {
      return file(context, () => ({
        relativePath,
        realmURL: new RealmPaths(this.cardService.defaultURL).url,
        onStateChange: (state) => {
          if (state === 'not-found') {
            console.log('NOT FOUND!');
          }
        },
      }));
    } else {
      return undefined;
    }
  });

  get fileReady() {
    return this.file.current?.state === 'ready';
  }

  get json() {
    if (this.file.current?.state === 'ready') {
      try {
        return JSON.parse(this.file.current?.content);
      } catch (e) {
        return undefined;
      }
    }

    return undefined;
  }

  get isCard() {
    if (this.json) {
      return isCardResource(this.json.data);
    }

    return false;
  }

  get title() {
    if (
      this.isCard &&
      this.card.current &&
      this.card.current.state === 'ready'
    ) {
      let cardTitle = this.card.current.card.title;

      if (cardTitle) {
        return cardTitle;
      }
    }

    return this.args.file;
  }

  card = maybe(this, (context) => {
    if (this.isCard) {
      let cardId = this.args.file.replace(/\.json$/, '');
      return card(context, () => ({
        url: new URL(`${this.cardService.defaultURL}${cardId}`),
      }));
    }

    return null;
  });
}
