import { type Room as MatrixRoom } from 'matrix-js-sdk';
import { Context, setRoomMeta } from './index';

export function onRoomName(context: Context) {
  return (room: MatrixRoom) => {
    let { roomId, name } = room;
    // This seems to be some kind of matrix default which is not helpful
    if (name === 'Empty room') {
      return;
    }

    setRoomMeta(context, roomId, { name });
  };
}
