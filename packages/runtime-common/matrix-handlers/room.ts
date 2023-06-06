import { type Room as MatrixRoom } from 'matrix-js-sdk';
import { Context, setRoomMeta } from './index';

export function onRoomName(context: Context, onlyForRoomId?: string) {
  return (room: MatrixRoom) => {
    let { roomId, name } = room;
    if (onlyForRoomId && roomId !== onlyForRoomId) {
      return;
    }
    // This seems to be some kind of matrix default which is not helpful
    if (name === 'Empty room') {
      return;
    }

    setRoomMeta(context, roomId, { name });
  };
}
