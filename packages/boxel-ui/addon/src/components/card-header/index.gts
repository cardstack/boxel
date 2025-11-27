import type { MenuDivider } from '@cardstack/boxel-ui/helpers.ts';
import { DropdownArrowDown } from '@cardstack/boxel-ui/icons';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import type { ComponentLike } from '@glint/template';

import cssVar from '../..//helpers/css-var.ts';
import cn from '../../helpers/cn.ts';
import { getContrastColor } from '../../helpers/contrast-color.ts';
import { MenuItem } from '../../helpers/menu-item.ts';
import { and } from '../../helpers/truth-helpers.ts';
import { bool, or } from '../../helpers/truth-helpers.ts';
import setCssVar from '../../modifiers/set-css-var.ts';
import Button from '../button/index.gts';
import ContextButton from '../context-button/index.gts';
import BoxelDropdown from '../dropdown/index.gts';
import Menu from '../menu/index.gts';
import RealmIcon, { type RealmDisplayInfo } from '../realm-icon/index.gts';
import Tooltip from '../tooltip/index.gts';

export interface CardHeaderUtilityMenu {
  menuItems: (MenuItem | MenuDivider)[];
  triggerText: string;
}

interface Signature {
  Args: {
    cardTitle?: string;
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
    utilityMenu?: CardHeaderUtilityMenu;
  };
  Element: HTMLElement;
}

export default class CardHeader extends Component<Signature> {
  get safeMoreOptionsMenuItems() {
    return this.args.moreOptionsMenuItems || [];
  }
  <template>
    {{#let (bool @onFinishEditing) as |isEditing|}}
      <header
        data-test-card-header
        class={{cn is-editing=isEditing}}
        {{setCssVar
          boxel-card-header-background-color=@headerColor
          boxel-card-header-text-color=(getContrastColor @headerColor)
        }}
        ...attributes
      >
        <div
          class='realm-icon-container'
          style={{if
            @headerColor
            (cssVar
              boxel-realm-icon-background-color=(getContrastColor
                @headerColor 'transparent'
              )
              boxel-realm-icon-border-color=(getContrastColor
                @headerColor 'rgba(0, 0, 0, 0.15)'
              )
            )
          }}
        >
          {{#if @realmInfo.iconURL}}
            <Tooltip @placement='right'>
              <:trigger>
                <RealmIcon
                  @canAnimate={{@isTopCard}}
                  @realmInfo={{@realmInfo}}
                  class='realm-icon'
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
          {{#if @cardTypeDisplayName}}<span
              class='card-type-display-name-text'
            >{{@cardTypeDisplayName}}</span>{{/if}}
          {{#if (and @cardTypeDisplayName @cardTitle)}}<span
              class='card-title-text'
            >-</span>
          {{/if}}
          {{#if @cardTitle}}<span class='card-title-text'>
              {{@cardTitle}}</span>{{/if}}
          {{#if (or @isSaving (bool @lastSavedMessage))}}
            <div class='save-indicator' data-test-auto-save-indicator>
              {{#if @isSaving}}
                Saving…
              {{else if (bool @lastSavedMessage)}}
                <div class='boxel-contents-only' data-test-last-saved>
                  {{@lastSavedMessage}}
                </div>
              {{/if}}
            </div>
          {{/if}}
        </div>

        <div class='actions' data-test-boxel-card-header-actions>
          {{#if @utilityMenu}}
            <div class='utility-menu-positioner'>
              <BoxelDropdown @autoClose={{true}}>
                <:trigger as |ddModifier|>
                  <Button class='utility-menu-trigger' {{ddModifier}}>
                    <span>
                      {{@utilityMenu.triggerText}}
                    </span>
                    <DropdownArrowDown
                      class='utility-menu-dropdown-arrow'
                      width='13px'
                      height='13px'
                    />
                  </Button>
                </:trigger>
                <:content as |dd|>
                  <Menu
                    @items={{@utilityMenu.menuItems}}
                    @closeMenu={{dd.close}}
                  />
                </:content>
              </BoxelDropdown>
            </div>
          {{/if}}
          {{#if @onEdit}}
            <Tooltip @placement='top'>
              <:trigger>
                <ContextButton
                  class='icon-button'
                  @icon='edit'
                  @label='Edit'
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
                <ContextButton
                  class='icon-save'
                  @icon='edit'
                  @label='Finish Editing'
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
                      <ContextButton
                        class='icon-button'
                        @variant={{if isEditing 'ghost'}}
                        @label='Options'
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
                <ContextButton
                  class='icon-button'
                  @icon='close'
                  @variant={{if isEditing 'ghost'}}
                  @label='Close'
                  @width='24'
                  @height='24'
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
    {{/let}}
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
            var(--boxel-icon-sm)
          );
          position: relative;
          display: flex;
          align-items: center;
          min-height: var(--boxel-card-header-min-height, 1.875rem); /* 30px */
          width: 100%;
          box-sizing: border-box;
          overflow: hidden;
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
          color: var(--boxel-dark);
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
          flex-shrink: 1;
          min-width: 0;
          text-align: center;
          padding: 0 30px;
        }
        .card-type-display-name-text {
          font: 700 var(--boxel-font-sm);
        }
        .card-title-text {
          font: 500 var(--boxel-font-sm);
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
          font: var(--boxel-font-xs);
          letter-spacing: var(--boxel-lsp-sm);
        }
        .realm-icon-container {
          display: flex;
          align-items: center;
          min-width: var(--boxel-card-header-icon-container-min-width);
          justify-content: left;
          --boxel-realm-icon-background-color: var(
            --realm-icon-background-color
          );
          --boxel-realm-icon-border-color: var(--realm-icon-border-color);
          --boxel-realm-icon-border-radius: var(
            --realm-icon-border-radius,
            7px
          );
        }

        .realm-icon {
          width: var(--inner-boxel-card-header-realm-icon-size);
          height: var(--inner-boxel-card-header-realm-icon-size);
        }

        .actions {
          display: flex;
          align-items: center;
          margin-left: auto;
          gap: var(--boxel-sp-5xs);
          min-width: var(--boxel-card-header-actions-min-width);
          justify-content: right;
        }

        .icon-button,
        .icon-save {
          z-index: 1;
        }
        .icon-button :deep(svg) {
          stroke-width: 2.5;
        }

        .icon-save {
          background-color: var(--boxel-light);
        }

        .utility-menu-positioner {
          --utility-menu-trigger-height: 26px;
          position: relative;
          margin-right: var(--boxel-sp);
          width: 1px;
          height: var(--utility-menu-trigger-height);
        }
        .utility-menu-trigger {
          --boxel-button-min-height: var(--utility-menu-trigger-height);
          --boxel-button-padding: 0 var(--boxel-sp-xxs);
          --boxel-button-border-radius: calc(var(--boxel-border-radius) - 4px);
          --boxel-button-font: var(--boxel-font-sm);
          --boxel-button-box-shadow: 0 3px 3px 0 rgba(0, 0, 0, 0.5);
          --boxel-button-border: solid 1px rgba(0, 0, 0, 0.35);

          position: absolute;
          top: 0;
          right: 0;
          width: max-content;
        }
        .utility-menu-dropdown-arrow {
          margin-left: var(--boxel-sp-xl);
          vertical-align: middle;
        }
      }
    </style>
  </template>
}
