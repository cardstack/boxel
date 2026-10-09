// A handler run for a room, from the moment its event arrives until its last
// bot-tool call is fulfilled. The room's history is read once, and only up to
// the run's own event, so a stop that lands later is not in it; marking the
// run is how the stop still reaches the parts of it that come after — the
// correctness check or generation that has not started yet, and the bot-tool
// calls waiting to run.
export interface RoomTurn {
  readonly stopped: boolean;
}

interface MutableRoomTurn extends RoomTurn {
  stopped: boolean;
}

export class RoomTurns {
  #turns = new Map<string, Set<MutableRoomTurn>>();

  begin(roomId: string): RoomTurn {
    let turn: MutableRoomTurn = { stopped: false };
    let turns = this.#turns.get(roomId);
    if (!turns) {
      turns = new Set();
      this.#turns.set(roomId, turns);
    }
    turns.add(turn);
    return turn;
  }

  end(roomId: string, turn: RoomTurn) {
    let turns = this.#turns.get(roomId);
    if (!turns) {
      return;
    }
    turns.delete(turn as MutableRoomTurn);
    if (turns.size === 0) {
      this.#turns.delete(roomId);
    }
  }

  // Marks every run in flight for the room as stopped. A run's lock is
  // released before its bot-tool calls are fulfilled, so the next run can be
  // in flight alongside it; both belong to the loop the user stopped.
  stop(roomId: string) {
    for (let turn of this.#turns.get(roomId) ?? []) {
      turn.stopped = true;
    }
  }
}
