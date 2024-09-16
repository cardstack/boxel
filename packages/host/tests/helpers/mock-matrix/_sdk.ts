import type { ExtendedMatrixSDK } from '@cardstack/host/services/matrix-sdk-loader';

import { MockClient } from './_client';
import { ServerState } from './_server-state';

import type { Config } from '../mock-matrix';

import type * as MatrixSDK from 'matrix-js-sdk';

// without this, using a class as an interface forces you to have the same
// private and protected methods too
type PublicAPI<T> = { [K in keyof T]: T[K] };

export class MockSDK implements PublicAPI<ExtendedMatrixSDK> {
  serverState: ServerState;

  constructor(private sdkOpts: Config) {
    this.serverState = new ServerState({
      displayName: sdkOpts.displayName ?? '',
    });
  }

  createClient(clientOpts: MatrixSDK.ICreateClientOpts) {
    return new MockClient(this, this.serverState, clientOpts, this.sdkOpts);
  }

  getRoomEvents(roomId: string) {
    return this.serverState.getRoomEvents(roomId);
  }

  RoomEvent = {
    Timeline: 'Room.timeline',
    LocalEchoUpdated: 'Room.localEchoUpdated',
    Receipt: 'Room.receipt',
  } as ExtendedMatrixSDK['RoomEvent'];

  RoomMemberEvent = {
    Membership: 'RoomMember.membership',
  } as ExtendedMatrixSDK['RoomMemberEvent'];

  Preset = {
    PrivateChat: 'private_chat',
    TrustedPrivateChat: 'trusted_private_chat',
    PublicChat: 'public_chat',
  } as ExtendedMatrixSDK['Preset'];

  ClientEvent = {
    AccountData: 'accountData',
  } as ExtendedMatrixSDK['ClientEvent'];
}
