import { fn, array } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';

import { format as formatDate } from 'date-fns';

import {
  BoxelDropdown,
  IconButton,
  Menu,
  Tooltip,
} from '@cardstack/boxel-ui/components';
import { menuItem } from '@cardstack/boxel-ui/helpers';
import {
  Upload,
  IconPencil,
  IconTrash,
  ThreeDotsHorizontal,
} from '@cardstack/boxel-ui/icons';

import type { RoomField } from 'https://cardstack.com/base/room';

export type RoomActions = {
  open: (roomId: string) => void;
  rename: (room: RoomField) => void;
  delete: (room: RoomField) => void;
};

interface Signature {
  Args: {
    room: RoomField;
    actions: RoomActions;
  };
}

export default class PastSessionItem extends Component<Signature> {
  <template>
    <li class='session' data-test-joined-room={{@room.name}}>
      <button
        class='view-session-button'
        {{on 'click' (fn @actions.open @room.roomId)}}
        data-test-enter-room={{@room.name}}
      >
        <div class='name'>{{@room.name}}</div>
        <div class='date'>
          {{formatDate @room.created 'iiii MMM d, yyyy, h:mm aa'}}
        </div>
      </button>
      <BoxelDropdown>
        <:trigger as |bindings|>
          <Tooltip @placement='top'>
            <:trigger>
              <IconButton
                @icon={{ThreeDotsHorizontal}}
                @width='20px'
                @height='20px'
                class='menu-button'
                aria-label='Options'
                data-test-past-session-options-button={{@room.name}}
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
            class='menu past-session-menu'
            @closeMenu={{dd.close}}
            @items={{array
              (menuItem
                'Open Session' (fn @actions.open @room.roomId) icon=Upload
              )
              (menuItem 'Rename' (fn @actions.rename @room) icon=IconPencil)
              (menuItem 'Delete' (fn @actions.delete @room) icon=IconTrash)
            }}
          />
        </:content>
      </BoxelDropdown>
    </li>

    <style>
      .session {
        display: flex;
        align-items: center;
        justify-content: space-between;
        border-top: 1px solid var(--boxel-300);
        padding-top: var(--boxel-sp-sm);
        padding-left: var(--boxel-sp-xs);
        padding-bottom: var(--boxel-sp-sm);
        margin-right: var(--boxel-sp-xs);
        margin-left: var(--boxel-sp-xs);
      }
      .session:hover {
        background-color: var(--boxel-200);
        cursor: pointer;
        border-radius: 8px;
      }
      .session:hover + .session {
        border-top-color: transparent;
      }
      .name {
        font-weight: 600;
      }
      .date {
        margin-top: var(--boxel-sp-4xs);
        color: var(--boxel-450);
      }
      .view-session-button {
        background-color: transparent;
        border: none;
        width: 100%;
        text-align: left;
      }
      .menu-button:hover:not(:disabled) {
        --icon-color: var(--boxel-highlight);
      }
      .menu :deep(svg) {
        --icon-stroke-width: 1.5px;
      }
      .menu :deep(.boxel-menu__item:nth-child(2) svg) {
        --icon-stroke-width: 0.5px;
        width: 20px;
        height: 20px;
      }
    </style>
  </template>
}
