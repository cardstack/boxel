import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { CardDef, StringField, contains, field, Component } from './card-api';
import ColorField from './color';
import TagIcon from '@cardstack/boxel-icons/tag';
import {
  CardContentContainer,
  FieldContainer,
  Pill,
} from '@cardstack/boxel-ui/components';
import { cn } from '@cardstack/boxel-ui/helpers';

interface TagSignature {
  Args: {
    name?: string;
    backgroundColor?: string;
    ellipsize?: boolean;
  };
  Element: HTMLElement;
}

const TagComponent: TemplateOnlyComponent<TagSignature> = <template>
  <Pill
    class='tag-pill'
    @pillBackgroundColor={{@backgroundColor}}
    ...attributes
  >
    <:default>
      <span class={{cn 'name' ellipsize=@ellipsize}}>{{@name}}</span>
    </:default>
  </Pill>

  <style scoped>
    @layer {
      .tag-pill {
        --pill-padding: var(--boxel-sp-xxxs) var(--boxel-sp-xxs);
        --pill-font: 500 var(--boxel-font-xs);
        --pill-border: none;
        letter-spacing: var(--boxel-lsp-sm);
        max-width: 100%;
        word-break: unset;
      }
      .ellipsize {
        white-space: nowrap;
        text-overflow: ellipsis;
        overflow: hidden;
      }
    }
  </style>
</template>;

class View extends Component<typeof Tag> {
  <template>
    <TagComponent
      @ellipsize={{true}}
      @name={{@model.name}}
      @backgroundColor={{@model.color}}
    />
  </template>
}

export class Tag extends CardDef {
  static displayName = 'Tag';
  static icon = TagIcon;
  @field name = contains(StringField);
  @field title = contains(StringField, {
    computeVia: function (this: Tag) {
      return this.name;
    },
  });
  @field color = contains(ColorField);

  static atom = View;
  static embedded = View;
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <CardContentContainer>
        <TagComponent
          @ellipsize={{true}}
          @name={{@model.name}}
          @backgroundColor={{@model.color}}
        />
      </CardContentContainer>
    </template>
  };
  static edit = class Edit extends Component<typeof this> {
    <template>
      <div class='container'>
        <FieldContainer @label='Preview'>
          <span>
            <TagComponent
              @ellipsize={{true}}
              @name={{@model.name}}
              @backgroundColor={{@model.color}}
            />
          </span>
        </FieldContainer>
        <FieldContainer @label='Name' @tag='label'>
          <@fields.name />
        </FieldContainer>
        <FieldContainer @label='Color' @tag='label'>
          <@fields.color />
        </FieldContainer>
      </div>
      <style scoped>
        .container {
          display: grid;
          gap: var(--boxel-sp);
          padding: var(--boxel-sp);
        }
      </style>
    </template>
  };
}
