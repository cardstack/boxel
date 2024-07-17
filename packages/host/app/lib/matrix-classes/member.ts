export interface RoomMemberInterface {
  userId: string;
  roomId?: string;
  displayName?: string;
  membership?: 'invite' | 'join' | 'leave';
  membershipDateTime?: Date;
  membershipInitiator?: string;
}

export class RoomMember implements RoomMemberInterface {
  userId: string;
  roomId?: string;
  displayName?: string;
  membership?: 'invite' | 'join' | 'leave';
  membershipDateTime?: Date;
  membershipInitiator?: string;

  constructor(
    init: Partial<RoomMemberInterface> & { userId: string } = { userId: '' },
  ) {
    this.userId = init.userId;
    Object.assign(this, init);
  }

  get name(): string | undefined {
    return this.displayName ?? this.userId?.split(':')[0].substring(1);
  }
}
