// Serializes response handling per room inside one ai-bot process.
//
// A single sliding-sync response can carry several new events for one room,
// and matrix-js-sdk emits a RoomEvent.Timeline for each of them back to back.
// The timeline handler in main.ts is async, so without this every one of those
// handlers would race for the room lock in the database: one wins, the rest
// give up, and an event that never gets processed is never retried. If the
// winner is an older event, the room history it fetches stops at that event,
// so the turn that the dropped newer event should have completed hangs.
//
// The rule here is "one handler per room at a time, and only the newest event
// waits". The room history fetched for an event is truncated at that event, so
// a newer event's history already contains every older one, and processing the
// newest event alone reacts to all of them. Older events that are still
// waiting when a newer one arrives are told to stand down.
export class RoomEventSerializer {
  private turns = new Map<string, Promise<void>>();
  private newestEventIds = new Map<string, string>();

  // Waits until no earlier handler for this room is still running. Resolves to
  // a release function when the caller should go ahead, or to undefined when a
  // newer event for the same room arrived while waiting; the caller must then
  // skip the event, because the newer event's handler covers it.
  //
  // The release function must be called once the caller is done with the room,
  // on every exit path. Calling it more than once is harmless.
  async claim(
    roomId: string,
    eventId: string,
  ): Promise<(() => void) | undefined> {
    let previousTurn = this.turns.get(roomId) ?? Promise.resolve();
    let finishTurn!: () => void;
    let turn = new Promise<void>((resolve) => {
      finishTurn = resolve;
    });
    this.turns.set(roomId, turn);
    this.newestEventIds.set(roomId, eventId);

    let released = false;
    let release = () => {
      if (released) {
        return;
      }
      released = true;
      finishTurn();
      if (this.turns.get(roomId) === turn) {
        this.turns.delete(roomId);
        this.newestEventIds.delete(roomId);
      }
    };

    await previousTurn;

    if (this.newestEventIds.get(roomId) !== eventId) {
      release();
      return undefined;
    }
    return release;
  }
}
