import Maximize from '@cardstack/boxel-icons/maximize';
import type { MenuDivider } from '@cardstack/boxel-ui/helpers';
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
import ContextButton from '../context-button/index.gts';
import BoxelDropdown from '../dropdown/index.gts';
import Menu from '../menu/index.gts';
import RealmIcon, { type RealmDisplayInfo } from '../realm-icon/index.gts';
import SelectionMenu from '../selection-menu/index.gts';
import Tooltip from '../tooltip/index.gts';

export interface CardHeaderUtilityMenu {
  // Accessible name for the trigger; SelectionMenu defaults to `Selection menu, <count> selected`.
  label?: string;
  menuItems: (MenuItem | MenuDivider)[];
  selectedCount: number;
}

interface Signature {
  Args: {
    cardTitle?: string;
    cardTypeDisplayName?: string;
    cardTypeIcon?: ComponentLike<{ Element: Element }>;
    closeShortcutHint?: string;
    editShortcutHint?: string;
    finishEditingShortcutHint?: string;
    headerColor?: string;
    isExpanded?: boolean;
    isSaving?: boolean;
    isTopCard?: boolean;
    lastSavedMessage?: string;
    moreOptionsMenuItems?: MenuItem[];
    onClose?: () => void;
    onEdit?: () => void;
    onExpand?: () => void;
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

  get hasMoreOptionsMenuItems() {
    return this.safeMoreOptionsMenuItems.length > 0;
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
        <div class='boxel-card-header__inner'>
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
                <SelectionMenu
                  @selectedCount={{@utilityMenu.selectedCount}}
                  @items={{@utilityMenu.menuItems}}
                  @label={{@utilityMenu.label}}
                />
              </div>
            {{/if}}
            {{#if @onExpand}}
              <Tooltip class='expand-button-tooltip' @placement='top'>
                <:trigger>
                  <ContextButton
                    class='icon-button icon-button--maximize'
                    @icon={{Maximize}}
                    @isActive={{@isExpanded}}
                    @isToggle={{true}}
                    @label={{if @isExpanded 'Restore' 'Expand'}}
                    {{on 'click' @onExpand}}
                    data-test-expand-button={{if
                      @isExpanded
                      'active'
                      'not-active'
                    }}
                  />
                </:trigger>
                <:content>
                  {{if @isExpanded 'Restore' 'Expand to Full Width'}}
                </:content>
              </Tooltip>
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
                  Edit{{#if @editShortcutHint}}
                    ({{@editShortcutHint}})
                  {{/if}}
                </:content>
              </Tooltip>
            {{/if}}
            {{#if @onFinishEditing}}
              <Tooltip @placement='top'>
                <:trigger>
                  <ContextButton
                    class='icon-button icon-save'
                    @icon='edit'
                    @label='Finish Editing'
                    {{on 'click' @onFinishEditing}}
                    data-test-edit-button
                  />
                </:trigger>
                <:content>
                  Finish Editing{{#if @finishEditingShortcutHint}}
                    ({{@finishEditingShortcutHint}})
                  {{/if}}
                </:content>
              </Tooltip>
            {{/if}}
            {{#if this.hasMoreOptionsMenuItems}}
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
                  Close{{#if @closeShortcutHint}}
                    ({{@closeShortcutHint}})
                  {{/if}}
                </:content>
              </Tooltip>
            {{/if}}
          </div>
        </div>
      </header>
    {{/let}}
    <style scoped>
      @layer {
        header {
          container-type: inline-size;
          container-name: card-header;
          position: relative;
          min-height: var(--boxel-card-header-min-height, 1.875rem); /* 30px */
          width: 100%;
          max-width: 100%;
          box-sizing: border-box;
          overflow: hidden;
          display: flex;
          align-items: center;
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
          transition:
            background-color var(--boxel-transition),
            color var(--boxel-transition);
        }
        /* In a stacked (non-expanded) card, the whole header bar
           goes green when editing — original behavior. The expanded-
           card-header-pill in the host's top bar overrides this so
           only the pencil lights up (see submode-layout CSS). */
        header.is-editing {
          background-color: var(--boxel-highlight);
          color: var(--boxel-highlight-foreground);
        }
        .boxel-card-header__inner {
          width: 100%;
          max-width: 100%;
          display: flex;
          align-items: center;
          gap: var(--boxel-card-header-gap, var(--boxel-sp-xs));
          padding: var(--boxel-card-header-padding, var(--boxel-sp-xs));
          letter-spacing: var(--boxel-card-header-letter-spacing, normal);
          text-transform: var(--boxel-card-header-text-transform);
          font: var(--boxel-card-header-font-weight, 600)
            var(--boxel-card-header-text-font, var(--boxel-font-sm));
        }
        .card-type-display-name {
          max-width: var(--boxel-card-header-max-width, 100%);
          text-overflow: var(--boxel-card-header-text-overflow, ellipsis);
          overflow: hidden;
          text-wrap: nowrap;
          flex-grow: 1;
          flex-shrink: 1;
          min-width: 0;
          text-align: center;
        }
        .card-type-display-name-text {
          font: 700 var(--boxel-font-sm);
        }
        .card-title-text {
          font: 500 var(--boxel-font-sm);
        }

        .card-type-display-name > :deep(svg) {
          display: inline-block;
          vertical-align: middle;
          max-height: var(
            --boxel-card-header-card-type-icon-size,
            var(--boxel-icon-sm)
          );
          max-width: var(
            --boxel-card-header-card-type-icon-size,
            var(--boxel-icon-sm)
          );
          margin-right: var(--boxel-sp-3xs);
          margin-bottom: calc(1rem - var(--boxel-font-size-sm));
        }
        .save-indicator {
          font: var(--boxel-font-xs);
          letter-spacing: var(--boxel-lsp-sm);
        }
        .realm-icon-container {
          display: flex;
          align-items: center;
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
          width: var(
            --boxel-card-header-realm-icon-size,
            var(--boxel-icon-med)
          );
          height: var(
            --boxel-card-header-realm-icon-size,
            var(--boxel-icon-med)
          );
        }

        .actions {
          position: relative;
          display: flex;
          align-items: center;
          margin-left: auto;
          gap: var(--boxel-sp-5xs);
          justify-content: right;
        }

        /* (z-index removed from icon-button + icon-save — was z-index: 1
           which created a stacking context that trapped Tooltip's
           floating-ui popover beneath the pill. Tooltips now escape
           to #tooltip-overlay (z-index: 10000) and render above the
           pill cleanly.) */
        .icon-button :deep(svg) {
          stroke-width: 2.5;
        }
        /* Maximize icon has a 24-unit viewBox vs the pencil's 18.75
           unit viewBox; same stroke-width renders thinner. Bump it
           up so the expand icon visually matches the pencil weight. */
        .icon-button--maximize :deep(svg) {
          stroke-width: 3.2;
        }

        /* Pencil button in a stacked (non-expanded) editing card.
           The header behind it is already green (header.is-editing
           rule above), so the pencil sits white/light for contrast.
           Original behavior — the expanded pill overrides this in
           submode-layout CSS to make the pencil green-on-white. */
        .icon-save {
          background-color: var(--boxel-light);
        }

        /* The selection menu floats out of the actions flex flow, anchored
           just left of the action buttons. Keeping it out of flow means its
           presence doesn't widen the actions column, which would otherwise
           shift the centered card title off-center. With only `right` set
           (no width/left), the box shrinks to its content and grows leftward
           from that anchor. */
        .utility-menu-positioner {
          position: absolute;
          right: calc(100% + var(--boxel-sp-5xs));
          top: 50%;
          transform: translateY(-50%);
        }
        @container card-header (min-width: 30rem) {
          .card-type-display-name {
            padding-inline: 1.875rem;
          }
        }

        @container card-header (min-width: 28rem) {
          .realm-icon-container {
            min-width: var(--boxel-card-header-icon-container-min-width);
          }
          .actions {
            min-width: var(--boxel-card-header-actions-min-width);
          }
        }

        @container card-header (max-width: 20rem) {
          .boxel-card-header__inner {
            --boxel-card-header-padding: var(--boxel-sp-4xs);
            --boxel-card-header-gap: var(--boxel-sp-4xs);
          }
          .card-type-display-name > :deep(svg) {
            display: none;
          }
          .icon-button {
            width: var(--boxel-button-xs);
            height: var(--boxel-button-xs);
          }
          .icon-button :deep(svg) {
            width: var(--boxel-icon-xs);
            height: var(--boxel-icon-xs);
          }
          .realm-icon {
            --boxel-card-header-realm-icon-size: var(--boxel-icon-sm);
          }
          .expand-button-tooltip,
          .icon-button--maximize {
            display: none;
          }
        }
      }
    </style>
  </template>
}
