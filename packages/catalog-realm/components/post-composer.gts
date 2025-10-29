import GlimmerComponent from '@glimmer/component';
import { type BaseDef } from 'https://cardstack.com/base/card-api';
import { on } from '@ember/modifier';
import { BoxelSelect, BoxelButton } from '@cardstack/boxel-ui/components';
import { type PostType } from '../news-feed/communication-log';

interface PostComposerArgs {
  Args: {
    card: BaseDef;
    postTypes: PostType[];
    selectedPostType?: PostType;
    onPostSent: (card: BaseDef) => void; // Callback invoked when a post is submitted
    onPostTypeChange?: (postType: PostType) => void;
    isSubmitting?: boolean;
    isSubmitDisabled?: boolean;
  };
  Element: HTMLElement;
}

export class PostComposer extends GlimmerComponent<PostComposerArgs> {
  get selectedPostType(): PostType {
    return this.args.selectedPostType ?? this.args.postTypes?.[0];
  }

  get postTypes() {
    return this.args.postTypes ?? [];
  }

  get hasValidPostType() {
    return (
      this.selectedPostType &&
      this.selectedPostType.value &&
      this.selectedPostType.label
    );
  }

  get canSubmit() {
    return this.hasValidPostType && Boolean(this.args.card);
  }

  handlePostTypeChange = (selectedOption: PostType) => {
    // Notify parent component of the change
    this.args.onPostTypeChange?.(selectedOption);
  };

  handleFormSubmit = (event: Event) => {
    event.preventDefault();
    this.handlePostSent();
  };

  handlePostSent = () => {
    if (!this.canSubmit) {
      console.error('Invalid form submission');
      return;
    }

    this.args.onPostSent?.(this.args.card);
  };

  getComponent = (card: BaseDef) => card.constructor.getComponent(card);

  <template>
    <div class='post-composer'>
      {{#if this.postTypes.length}}
        <header class='composer-header'>
          <h3>Create Post ({{this.selectedPostType.label}})</h3>
          <BoxelSelect
            @selected={{this.selectedPostType}}
            @options={{this.postTypes}}
            @onChange={{this.handlePostTypeChange}}
            @placeholder='Select post type'
            @searchField='label'
            class='type-select'
            as |post|
          >
            {{post.value}}
          </BoxelSelect>
        </header>
      {{/if}}

      <form class='composer-content' {{on 'submit' this.handleFormSubmit}}>
        {{#let (this.getComponent @card) as |CardComponent|}}
          <CardComponent @format='edit' class='card-component' />
        {{/let}}

        <div class='composer-actions'>
          <BoxelButton
            type='submit'
            @kind='primary'
            @size='base'
            @loading={{@isSubmitting}}
            @disabled={{@isSubmitDisabled}}
            class='post-sent-button'
          >
            Post
          </BoxelButton>
        </div>
      </form>
    </div>

    <style scoped>
      .post-composer {
        background: white;
        border-radius: 12px;
        border: 1px solid #e5e7eb;
        padding: 1.5rem;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
        container-type: inline-size;
      }

      .post-composer :deep(.ember-basic-dropdown-content-wormhole-origin) {
        position: absolute;
      }

      .composer-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }

      .composer-content {
        display: flex;
        flex-direction: column;
        gap: 1rem;
        margin-top: 1rem;
        --radius: 0;
      }

      .type-select {
        flex: 1;
        max-width: 200px;
      }

      .card-component {
        --shadow: none;
      }

      .post-sent-button {
        --boxel-button-min-width: 100%;
        --boxel-button-border-radius: var(--boxel-border-radius);
      }
    </style>
  </template>
}
