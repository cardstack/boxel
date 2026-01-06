import type { TemplateOnlyComponent } from '@ember/component/template-only';

import { CardContainer, CardHeader } from '@cardstack/boxel-ui/components';
import type { MenuItem } from '@cardstack/boxel-ui/helpers';
import { eq, or } from '@cardstack/boxel-ui/helpers';

import {
  cardTypeDisplayName,
  cardTypeIcon,
  isCardInstance,
} from '@cardstack/runtime-common';

import CardRenderer from '@cardstack/host/components/card-renderer';
import FittedFormatGallery from '@cardstack/host/components/operator-mode/card-renderer-panel/fitted-format-gallery';
import type { EnhancedRealmInfo } from '@cardstack/host/services/realm';

import type {
  CardDef,
  FieldDef,
  Format,
} from 'https://cardstack.com/base/card-api';

interface Signature {
  Args: {
    format: Format;
    card: CardDef | FieldDef;
    isFieldDef?: boolean;
    realmInfo?: EnhancedRealmInfo;
    contextMenuItems?: MenuItem[];
    onEdit?: () => void;
    onFinishEditing?: () => void;
  };
}
const PlaygroundPreview: TemplateOnlyComponent<Signature> = <template>
  {{#if (or (eq @format 'isolated') (eq @format 'edit'))}}
    <CardContainer
      class={{if
        @isFieldDef
        'field-preview-container'
        'full-height-preview isolated-and-edit-preview'
      }}
    >
      {{#unless @isFieldDef}}
        <CardHeader
          class='preview-header'
          @cardTypeDisplayName={{cardTypeDisplayName @card}}
          @cardTypeIcon={{cardTypeIcon @card}}
          @cardTitle={{if (isCardInstance @card) @card.title undefined}}
          @realmInfo={{@realmInfo}}
          @onEdit={{@onEdit}}
          @onFinishEditing={{@onFinishEditing}}
          @isTopCard={{true}}
          @moreOptionsMenuItems={{@contextMenuItems}}
        />
      {{/unless}}
      <CardRenderer class='preview' @card={{@card}} @format={{@format}} />
    </CardContainer>
  {{else if (eq @format 'embedded')}}
    <CardContainer
      class={{if @isFieldDef 'field-preview-container' 'preview-container'}}
    >
      <CardRenderer class='preview' @card={{@card}} @format={{@format}} />
    </CardContainer>
  {{else if (eq @format 'head')}}
    <CardContainer class='preview-container'>
      <CardRenderer class='preview' @card={{@card}} @format={{@format}} />
    </CardContainer>
  {{else if (eq @format 'atom')}}
    <div class='atom-preview-container' data-test-atom-preview>Lorem ipsum dolor
      sit amet, consectetur adipiscing elit, sed do
      <CardRenderer
        class='atom-preview'
        @card={{@card}}
        @format={{@format}}
        @displayContainer={{false}}
      />
      tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim
      veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea
      commodo consequat.</div>
  {{else if (eq @format 'fitted')}}
    <FittedFormatGallery
      @card={{@card}}
      @isDarkMode={{true}}
      @isFieldDef={{@isFieldDef}}
    />
  {{/if}}

  <style scoped>
    .preview-container {
      height: auto;
    }
    .full-height-preview {
      flex-grow: 1;
      display: grid;
      grid-auto-rows: max-content 1fr;
      min-width: 0;
    }
    .preview-header {
      box-shadow: 0 1px 0 0 rgba(0 0 0 / 15%);
      z-index: 1;
    }
    .preview-header:not(.is-editing) {
      background-color: var(--boxel-100);
    }
    .field-preview-container {
      height: auto;
      padding: var(--boxel-sp);
    }
    .preview {
      box-shadow: none;
      border-radius: 0;
    }
    .atom-preview-container {
      color: #c7c7c7;
      font: 500 var(--boxel-font-sm);
      line-height: 2.15;
      letter-spacing: 0.13px;
    }
    .atom-preview :deep(.atom-default-template) {
      color: var(--boxel-dark);
      border-radius: var(--boxel-border-radius);
      padding: var(--boxel-sp-4xs);
      background-color: var(--boxel-light);
      margin: 0 var(--boxel-sp-xxxs);
      font: 600 var(--boxel-font-xs);
      line-height: 1.27;
      letter-spacing: 0.17px;
    }
  </style>
</template>;

export default PlaygroundPreview;
