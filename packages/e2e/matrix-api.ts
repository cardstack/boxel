// Minimal Matrix client-server calls for the smoke runner. The suite helpers
// in ../helpers are bound to the isolated test stack's context; these talk to
// whatever homeserver SMOKE_MATRIX_URL names (the dev stack's synapse by
// default) and need nothing else.

export const matrixUrl =
  process.env.SMOKE_MATRIX_URL ?? 'http://localhost:8008';

export interface Credentials {
  accessToken: string;
  userId: string;
  deviceId: string;
  homeServer: string;
}

export async function loginWithPassword(
  username: string,
  password: string,
): Promise<Credentials> {
  let response = await fetch(`${matrixUrl}/_matrix/client/v3/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'm.login.password',
      identifier: { type: 'm.id.user', user: username },
      password,
    }),
  });
  if (!response.ok) {
    throw new Error(
      `matrix login failed for ${username}: ${response.status} ${await response.text()}`,
    );
  }
  let json = (await response.json()) as {
    access_token: string;
    user_id: string;
    device_id: string;
    home_server?: string;
  };
  return {
    accessToken: json.access_token,
    userId: json.user_id,
    deviceId: json.device_id,
    homeServer: json.home_server ?? new URL(matrixUrl).host,
  };
}

export interface MatrixEvent {
  type: string;
  sender: string;
  event_id: string;
  origin_server_ts: number;
  state_key?: string;
  content: Record<string, any>;
}

// Every event in the room, oldest first, including state events.
export async function allRoomEvents(
  roomId: string,
  accessToken: string,
): Promise<MatrixEvent[]> {
  let events: MatrixEvent[] = [];
  let from: string | undefined;
  for (;;) {
    let url = new URL(
      `${matrixUrl}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/messages`,
    );
    url.searchParams.set('dir', 'f');
    url.searchParams.set('limit', '500');
    if (from) {
      url.searchParams.set('from', from);
    }
    let response = await fetch(url, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      throw new Error(
        `could not read room ${roomId}: ${response.status} ${await response.text()}`,
      );
    }
    let json = (await response.json()) as {
      chunk: MatrixEvent[];
      end?: string;
    };
    events.push(...json.chunk);
    if (!json.end || json.chunk.length === 0 || json.end === from) {
      break;
    }
    from = json.end;
  }
  return events;
}
