import { registerDestructor } from '@ember/destroyable';
import { fn } from '@ember/helper';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import { task } from 'ember-concurrency';

import Modifier from 'ember-modifier';

import { CardHeader } from '@cardstack/boxel-ui/components';
import { eq, MenuItem } from '@cardstack/boxel-ui/helpers';
import { IconLink, Eye } from '@cardstack/boxel-ui/icons';

import { cardTypeDisplayName, cardTypeIcon } from '@cardstack/runtime-common';

import CardRenderer from '@cardstack/host/components/card-renderer';

import { urlForRealmLookup } from '@cardstack/host/lib/utils';

import OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import RealmService from '@cardstack/host/services/realm';

import type { CardDef, Format } from 'https://cardstack.com/base/card-api';

import FormatChooser from '../code-submode/format-chooser';

import FittedFormatGallery from './fitted-format-gallery';

interface Signature {
  Element: HTMLElement;
  Args: {
    card: CardDef;
    format?: Format; // defaults to 'isolated'
    setFormat: (format: Format) => void;
  };
}

export default class CardRendererPanel extends Component<Signature> {
  @service private declare operatorModeStateService: OperatorModeStateService;
  @service private declare realm: RealmService;

  private scrollPositions = new Map<string, number>();
  private copyToClipboard = task(async () => {
    await navigator.clipboard.writeText(this.args.card.id);
  });

  private onScroll = (event: Event) => {
    let scrollPosition = (event.target as HTMLElement).scrollTop;
    this.scrollPositions.set(this.format, scrollPosition);
  };

  private get scrollPosition() {
    return this.scrollPositions.get(this.format);
  }

  private get format(): Format {
    return this.args.format ?? 'isolated';
  }

  private openInInteractMode = () => {
    this.operatorModeStateService.openCardInInteractMode(this.args.card.id);
  };

  private get realmInfo() {
    let url = this.args.card ? urlForRealmLookup(this.args.card) : undefined;
    if (!url) {
      return undefined;
    }
    return this.realm.info(url);
  }

  private get contextMenuItems(): MenuItem[] {
    let menuItems: MenuItem[] = [
      new MenuItem('Copy Card URL', 'action', {
        action: () => this.copyToClipboard.perform(),
        icon: IconLink,
      }),
      new MenuItem('Open in Interact Mode', 'action', {
        action: () => this.openInInteractMode(),
        icon: Eye,
      }),
    ];
    return menuItems;
  }

  private get canEditCard() {
    return Boolean(
      this.format !== 'edit' && this.realm.canWrite(this.args.card.id),
    );
  }

  <template>
    <CardHeader
      class='card-renderer-header'
      @cardTypeDisplayName={{cardTypeDisplayName @card}}
      @cardTypeIcon={{cardTypeIcon @card}}
      @cardTitle={{@card.title}}
      @realmInfo={{this.realmInfo}}
      @onEdit={{if this.canEditCard (fn @setFormat 'edit')}}
      @onFinishEditing={{if (eq this.format 'edit') (fn @setFormat 'isolated')}}
      @isTopCard={{true}}
      @moreOptionsMenuItems={{this.contextMenuItems}}
      data-test-code-mode-card-renderer-header={{@card.id}}
      ...attributes
    />
    <div
      class='card-renderer-body'
      data-test-code-mode-card-renderer-body
      {{ScrollModifier
        initialScrollPosition=this.scrollPosition
        onScroll=this.onScroll
      }}
    >
      <div class='card-renderer-content'>
        {{#if (eq this.format 'fitted')}}
          <FittedFormatGallery @card={{@card}} />
        {{else}}
          <CardRenderer @card={{@card}} @format={{this.format}} />
        {{/if}}
      </div>
    </div>
    <div class='card-renderer-format-chooser'>
      <FormatChooser @format={{this.format}} @setFormat={{@setFormat}} />
    </div>

    <style scoped>
      .card-renderer-header {
        min-height: max-content;
      }
      .card-renderer-body {
        flex-grow: 1;
        overflow-y: auto;
        z-index: 0;
      }
      .card-renderer-content {
        height: auto;
        margin: var(--boxel-sp-sm);
      }
      .card-renderer-content > :deep(.boxel-card-container.boundaries) {
        overflow: hidden;
      }
      .card-renderer-format-chooser {
        background-color: var(--boxel-dark);
        position: sticky;
        bottom: var(--boxel-sp-sm);
        width: 380px;
        margin: 0 auto;
        border-radius: var(--boxel-border-radius);
      }
      :deep(.format-chooser) {
        --boxel-format-chooser-border-color: var(--boxel-400);
        margin: 0;
        width: 100%;
        box-shadow: none;
        border-radius: var(--boxel-border-radius);
      }
    </style>
  </template>
}

interface ScrollSignature {
  Args: {
    Named: {
      initialScrollPosition?: number;
      onScroll?: (event: Event) => void;
    };
  };
}

class ScrollModifier extends Modifier<ScrollSignature> {
  modify(
    element: HTMLElement,
    _positional: [],
    { initialScrollPosition = 0, onScroll }: ScrollSignature['Args']['Named'],
  ) {
    // note that when testing make sure "disable cache" in chrome network settings is unchecked,
    // as this assumes that previously loaded images will be cached. otherwise the scroll will
    // happen *before* the geometry is altered by images that haven't completed loading yet.
    element.scrollTop = initialScrollPosition;
    if (onScroll) {
      element.addEventListener('scroll', onScroll);
      registerDestructor(this, () => {
        element.removeEventListener('scroll', onScroll);
      });
    }
  }
}
