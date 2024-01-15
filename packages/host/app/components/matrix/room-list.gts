import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';

import type { RoomField } from 'https://cardstack.com/base/room';

interface Signature {
  rooms: RoomField[];
  enterRoom: (roomId: string) => void;
}

const RoomList: TemplateOnlyComponent<Signature> = <template>
  <ul class='room-list' data-test-rooms-list>
    {{#each @rooms as |room|}}
      <li class='room-item' data-test-joined-room={{room.name}}>
        <button
          class='enter-room link'
          data-test-enter-room={{room.name}}
          {{on 'click' (fn @enterRoom room.roomId)}}
        >
          {{room.name}}
        </button>
      </li>
    {{else}}
      (No rooms)
    {{/each}}
  </ul>
  <style>
    .enter-room {
      padding: 0;
      background: none;
      border: none;
      text-align: left;
    }
  </style>
</template>;

export default RoomList;
