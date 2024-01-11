import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';

import type { RoomField } from 'https://cardstack.com/base/room';

interface Signature {
  enterRoom: (roomId: string) => void;
  rooms: RoomField[];
}

export default class RoomsList extends Component<Signature> {
  <template>
    {{#each @rooms as |room|}}
      <ul class='room' data-test-joined-room={{room.name}}>
        <li class='room-item'>
          <button
            class='enter-room link'
            data-test-enter-room={{room.name}}
            {{on 'click' (fn @enterRoom room.roomId)}}
          >
            {{room.name}}
          </button>
        </li>
      </ul>
    {{else}}
      (No rooms)
    {{/each}}
  </template>
}
