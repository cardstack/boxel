function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function slidingSyncRoomIds(
  response: unknown,
  listName: string,
): string[] {
  if (!record(response)) return [];
  let ids = new Set<string>();
  let list = record(response.lists) ? response.lists[listName] : undefined;
  if (record(list) && Array.isArray(list.ops)) {
    for (let op of list.ops) {
      if (!record(op)) continue;
      if (Array.isArray(op.room_ids)) {
        for (let id of op.room_ids) if (typeof id === 'string') ids.add(id);
      }
      if (typeof op.room_id === 'string') ids.add(op.room_id);
    }
  }
  if (record(response.rooms)) {
    for (let [id, room] of Object.entries(response.rooms)) {
      if (
        record(room) &&
        Array.isArray(room.lists) &&
        room.lists.includes(listName)
      )
        ids.add(id);
    }
  }
  return [...ids];
}
