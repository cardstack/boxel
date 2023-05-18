import Route from '@ember/routing/route';
import { service } from '@ember/service';
import { TrackedMap } from 'tracked-built-ins';
import { type RoomMember } from 'matrix-js-sdk';
import type MatrixService from '../../services/matrix-service';

export default class Room extends Route<{
  roomId: string;
  members: Map<string, { member: RoomMember; status: 'join' | 'invite' }>;
}> {
  @service private declare matrixService: MatrixService;

  async model(params: { id: string }) {
    let { id } = params;
    return {
      roomId: id,
      members: this.matrixService.roomMembers.get(id) ?? new TrackedMap(),
    };
  }
}
