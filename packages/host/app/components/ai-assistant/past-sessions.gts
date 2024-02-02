import { fn, array, hash } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';

import ToElsewhere from 'ember-elsewhere/components/to-elsewhere';

import { format as formatDate } from 'date-fns';

import {
  BoxelDropdown,
  IconButton,
  Menu,
  Tooltip,
} from '@cardstack/boxel-ui/components';
import { eq, menuItem } from '@cardstack/boxel-ui/helpers';
import {
  Upload,
  IconTrash,
  ThreeDotsHorizontal,
} from '@cardstack/boxel-ui/icons';

import type { RoomField } from 'https://cardstack.com/base/room';

import type { AiSessionRoom } from '@cardstack/host/components/ai-assistant/panel';
import DeleteModal from '@cardstack/host/components/operator-mode/delete-modal';

interface Signature {
  Args: {
    sessions: AiSessionRoom[];
    openSession: (roomId: string) => void;
    deleteSession: (roomId: string) => void;
    roomToDelete: RoomField | undefined;
    setRoomToDelete: (room: RoomField | undefined) => void;
  };
  Element: HTMLButtonElement;
}

export default class AiAssistantPastSessionsList extends Component<Signature> {
  <template>
    <style>
      .past-sessions {
        list-style-type: none;
        padding: 0;
        margin: 0;
        margin-bottom: var(--boxel-sp-xs);
      }

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

      .view-session-button {
        background-color: transparent;
        border: none;
        width: 100%;
        text-align: left;
      }

      .session:hover {
        background-color: var(--boxel-200);
        cursor: pointer;
        border-radius: 8px;
      }

      .session:hover + .session {
        border-top-color: transparent;
      }

      .top {
        font-weight: 600;
      }

      .bottom {
        margin-top: var(--boxel-sp-4xs);
        color: var(--boxel-450);
      }

      .empty-collection {
        padding: var(--boxel-sp-sm);
        text-align: center;
        color: var(--boxel-450);
      }

      .more-options-menu :deep(svg) {
        --icon-stroke-width: 1.5px;
      }
    </style>

    {{#if (eq @sessions.length 0)}}
      <div class='empty-collection'>
        No past sessions to show.
      </div>
    {{else}}
      <ul class='past-sessions'>
        {{#each @sessions as |session|}}
          <li class='session' data-test-joined-room={{session.room.name}}>
            <button
              class='view-session-button'
              {{on 'click' (fn @openSession session.room.roomId)}}
              data-test-enter-room={{session.room.name}}
            >
              <div class='top'>{{session.room.name}}</div>
              <div class='bottom'>{{formatDate
                  session.member.membershipDateTime
                  'iiii MMM d, yyyy, h:mm aa'
                }}</div>
            </button>
            <BoxelDropdown>
              <:trigger as |bindings|>
                <Tooltip @placement='top'>
                  <:trigger>
                    <IconButton
                      @icon={{ThreeDotsHorizontal}}
                      @width='20px'
                      @height='20px'
                      class='more-options-button'
                      aria-label='Options'
                      data-test-past-session-options-button={{session.room.name}}
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
                  class='more-options-menu'
                  @closeMenu={{dd.close}}
                  @items={{array
                    (menuItem
                      'Open Session'
                      (fn @openSession session.room.roomId)
                      icon=Upload
                    )
                    (menuItem
                      'Delete' (fn @setRoomToDelete session.room) icon=IconTrash
                    )
                  }}
                />
              </:content>
            </BoxelDropdown>
          </li>
        {{/each}}
      </ul>
    {{/if}}

    {{#let @roomToDelete.roomId @roomToDelete.name as |id name|}}
      {{#if id}}
        <ToElsewhere
          @named='delete-modal'
          @send={{component
            DeleteModal
            itemToDelete=id
            onConfirm=(fn @deleteSession id)
            onCancel=(fn @setRoomToDelete undefined)
            itemInfo=(hash type='room' name=(if name name id) id=id)
          }}
        />
      {{/if}}
    {{/let}}
  </template>
}
