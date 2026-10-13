// A handler run for a room, from the moment its event arrives until its last
// bot-tool call is fulfilled. The room's history is read once, and only up to
// the run's own event, so a stop that lands later is not in it; marking the
// run is how the stop still reaches the parts of it that come after — the
// correctness check or generation that has not started yet, and the bot-tool
// calls waiting to run.
export interface RoomTurn {
  readonly stopped: boolean;
  // Runs `cb` once the run is stopped: now, if it already is, otherwise when
  // the stop lands. For the things a stop must abort that may not exist yet
  // when it lands (the LLM runner, a compaction request). Each callback runs
  // at most once, and none runs after the run has ended.
  whenStopped(cb: () => void): void;
}

class Turn implements RoomTurn {
  stopped = false;
  #ended = false;
  #callbacks = new Set<() => void>();

  whenStopped(cb: () => void) {
    if (this.#ended) {
      return;
    }
    if (this.stopped) {
      cb();
      return;
    }
    this.#callbacks.add(cb);
  }

  stop() {
    if (this.stopped) {
      return;
    }
    this.stopped = true;
    let callbacks = [...this.#callbacks];
    this.#callbacks.clear();
    for (let cb of callbacks) {
      cb();
    }
  }

  end() {
    this.#ended = true;
    this.#callbacks.clear();
  }
}

export class RoomTurns {
  #turns = new Map<string, Set<Turn>>();

  begin(roomId: string): RoomTurn {
    let turn = new Turn();
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
    if (!turns || !(turn instanceof Turn)) {
      return;
    }
    turn.end();
    turns.delete(turn);
    if (turns.size === 0) {
      this.#turns.delete(roomId);
    }
  }

  // Marks every run in flight for the room as stopped. A run's lock is
  // released before its bot-tool calls are fulfilled, so the next run can be
  // in flight alongside it; both belong to the loop the user stopped.
  stop(roomId: string) {
    for (let turn of this.#turns.get(roomId) ?? []) {
      turn.stop();
    }
  }
}
