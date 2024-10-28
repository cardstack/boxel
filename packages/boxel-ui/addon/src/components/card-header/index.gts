import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import type { ComponentLike } from '@glint/template';

import cssVar from '../..//helpers/css-var.ts';
import cn from '../../helpers/cn.ts';
import { getContrastColor } from '../../helpers/contrast-color.ts';
import { MenuItem } from '../../helpers/menu-item.ts';
import { bool, or } from '../../helpers/truth-helpers.ts';
import { IconPencil, IconX, ThreeDotsHorizontal } from '../../icons.gts';
import setCssVar from '../../modifiers/set-css-var.ts';
import BoxelDropdown from '../dropdown/index.gts';
import IconButton from '../icon-button/index.gts';
import Menu from '../menu/index.gts';
import RealmIcon, { type RealmDisplayInfo } from '../realm-icon/index.gts';
import Tooltip from '../tooltip/index.gts';

interface Signature {
  Args: {
    cardTypeDisplayName?: string;
    cardTypeIcon?: ComponentLike<{ Element: Element }>;
    headerColor?: string;
    isSaving?: boolean;
    isTopCard?: boolean;
    lastSavedMessage?: string;
    moreOptionsMenuItems?: MenuItem[];
    onClose?: () => void;
    onEdit?: () => void;
    onFinishEditing?: () => void;
    realmInfo?: RealmDisplayInfo;
  };
  Blocks: {
    actions: [];
  };
  Element: HTMLElement;
}

export default class CardHeader extends Component<Signature> {
  get safeMoreOptionsMenuItems() {
    return this.args.moreOptionsMenuItems || [];
  }
  <template>
    <header
      data-test-card-header
      class={{cn is-editing=(bool @onFinishEditing)}}
      {{setCssVar
        boxel-card-header-background-color=@headerColor
        boxel-card-header-text-color=(getContrastColor @headerColor)
      }}
      ...attributes
    >
      <div class='realm-icon-container'>
        {{#if @realmInfo.iconURL}}
          <Tooltip @placement='right'>
            <:trigger>
              <RealmIcon
                @canAnimate={{@isTopCard}}
                @realmInfo={{@realmInfo}}
                class='realm-icon'
                style={{cssVar
                  realm-icon-background=(getContrastColor
                    @headerColor 'transparent'
                  )
                }}
                data-test-card-header-realm-icon={{@realmInfo.iconURL}}
              />
            </:trigger>
            <:content>
              In
              {{@realmInfo.name}}
            </:content>
          </Tooltip>
        {{/if}}
      </div>

      <div class='card-type-display-name' data-test-boxel-card-header-title>
        {{#if @cardTypeIcon}}<@cardTypeIcon />{{/if}}
        {{#if @cardTypeDisplayName}}{{@cardTypeDisplayName}}{{/if}}
        {{#if (or @isSaving (bool @lastSavedMessage))}}
          <div class='save-indicator' data-test-auto-save-indicator>
            {{#if @isSaving}}
              Saving…
            {{else if (bool @lastSavedMessage)}}
              <div data-test-last-saved>
                {{@lastSavedMessage}}
              </div>
            {{/if}}
          </div>
        {{/if}}
      </div>

      <div class='actions' data-test-boxel-card-header-actions>
        {{#if @onEdit}}
          <Tooltip @placement='top'>
            <:trigger>
              <IconButton
                @icon={{IconPencil}}
                @width='20px'
                @height='20px'
                class='icon-button'
                aria-label='Edit'
                {{on 'click' @onEdit}}
                data-test-edit-button
              />
            </:trigger>
            <:content>
              Edit
            </:content>
          </Tooltip>
        {{/if}}
        {{#if @onFinishEditing}}
          <Tooltip @placement='top'>
            <:trigger>
              <IconButton
                @icon={{IconPencil}}
                @width='20px'
                @height='20px'
                class='icon-save'
                aria-label='Finish Editing'
                {{on 'click' @onFinishEditing}}
                data-test-edit-button
              />
            </:trigger>
            <:content>
              Finish Editing
            </:content>
          </Tooltip>
        {{/if}}
        {{#if (bool @moreOptionsMenuItems)}}
          <div>
            <BoxelDropdown>
              <:trigger as |bindings|>
                <Tooltip @placement='top'>
                  <:trigger>
                    <IconButton
                      @icon={{ThreeDotsHorizontal}}
                      @width='20px'
                      @height='20px'
                      class='icon-button'
                      aria-label='Options'
                      data-test-more-options-button
                      {{bindings}}
                    />
                  </:trigger>
                  <:content>
                    More Options
                  </:content>
                </Tooltip>
              </:trigger>
              <:content as |dd|>
                <Menu
                  @closeMenu={{dd.close}}
                  @items={{this.safeMoreOptionsMenuItems}}
                />
              </:content>
            </BoxelDropdown>
          </div>
        {{/if}}

        {{#if @onClose}}
          <Tooltip @placement='top'>
            <:trigger>
              <IconButton
                @icon={{IconX}}
                @width='16px'
                @height='16px'
                class='icon-button'
                aria-label='Close'
                {{on 'click' @onClose}}
                data-test-close-button
              />
            </:trigger>
            <:content>
              Close
            </:content>
          </Tooltip>
        {{/if}}
      </div>
    </header>
    <style scoped>
      @layer {
        header {
          --inner-boxel-card-header-padding: var(
            --boxel-card-header-padding,
            var(--boxel-sp-xs)
          );
          --inner-boxel-card-header-realm-icon-size: var(
            --boxel-card-header-realm-icon-size,
            var(--boxel-icon-med)
          );
          --inner-boxel-card-header-card-type-icon-size: var(
            --boxel-card-header-card-type-icon-size,
            1rem
          );
          position: relative;
          display: flex;
          align-items: center;
          min-height: var(--boxel-card-header-min-height, 1.875rem); /* 30px */
          color: var(--boxel-card-header-text-color, var(--boxel-dark));
          background-color: var(
            --boxel-card-header-background-color,
            var(--boxel-light)
          );
          border-top-right-radius: calc(
            var(--boxel-card-header-border-radius, var(--boxel-border-radius)) -
              1px
          );
          border-top-left-radius: calc(
            var(--boxel-card-header-border-radius, var(--boxel-border-radius)) -
              1px
          );
          letter-spacing: var(--boxel-card-header-letter-spacing, normal);
          text-transform: var(--boxel-card-header-text-transform);
          transition:
            background-color var(--boxel-transition),
            color var(--boxel-transition);
          gap: var(--boxel-card-header-gap, var(--boxel-sp-xs));
          padding: var(--inner-boxel-card-header-padding, var(--boxel-sp-xl));
          font: var(--boxel-card-header-font-weight, 600)
            var(--boxel-card-header-text-font, var(--boxel-font-sm));
        }
        header.is-editing {
          background-color: var(--boxel-highlight);
          color: var(--boxel-light);
        }
        header .card-type-display-name {
          max-width: var(
            --boxel-card-header-max-width,
            100%
          ); /* this includes the space to show the header buttons */
          text-overflow: var(--boxel-card-header-text-overflow, ellipsis);
          overflow: hidden;
          text-wrap: nowrap;
          flex-grow: 1;
          text-align: center;
        }

        header .card-type-display-name > :deep(svg) {
          display: inline-block;
          vertical-align: middle;
          max-height: var(--inner-boxel-card-header-card-type-icon-size);
          max-width: var(--inner-boxel-card-header-card-type-icon-size);
          margin-right: var(--boxel-sp-xxxs);
          margin-bottom: calc(1rem - var(--boxel-font-size-sm));
        }
        .save-indicator {
          font-weight: normal;
          line-height: 1.1;
        }
        .realm-icon-container {
          display: flex;
          align-items: center;
          min-width: var(--boxel-card-header-icon-container-min-width);
          justify-content: left;
        }
        .realm-icon {
          width: var(--inner-boxel-card-header-realm-icon-size);
          height: var(--inner-boxel-card-header-realm-icon-size);
          background-color: var(--realm-icon-background);
          border: 1px solid rgba(0, 0, 0, 0.15);
          border-radius: 7px;
        }

        .is-editing .realm-icon {
          background: var(--boxel-light);
          border: 1px solid var(--boxel-light);
        }

        .actions {
          display: flex;
          align-items: center;
          margin-left: auto;
          gap: var(--boxel-sp-xxs);
          min-width: var(--boxel-card-header-actions-min-width);
          justify-content: right;
        }
        .is-editing .icon-button {
          --icon-color: var(--boxel-light);
        }

        .is-editing .icon-button:hover {
          --icon-color: var(--boxel-highlight);
          --boxel-icon-button-background: var(--boxel-light);
        }

        .icon-button,
        .icon-save {
          --boxel-icon-button-width: 26px;
          --boxel-icon-button-height: 26px;
          border-radius: 4px;

          display: flex;
          align-items: center;
          justify-content: center;
          font: var(--boxel-font-sm);
          z-index: 1;
        }

        .icon-button {
          --icon-color: var(--boxel-header-text-color, var(--boxel-highlight));
        }

        .icon-button:hover {
          --icon-color: var(--boxel-light);
          --boxel-icon-button-background: var(--boxel-highlight);
        }

        header .icon-save {
          --icon-color: var(--boxel-dark);
          --boxel-icon-button-background: var(--boxel-light);
        }

        header .icon-save:hover {
          --icon-color: var(--boxel-highlight);
        }
      }
    </style>
  </template>
}
