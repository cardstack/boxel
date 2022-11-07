import type { Card } from "./card-api";

export class Cycle extends Error {
  readonly isCycle: true = true;
  constructor(readonly terminatingInstance: Card) {
    super();
  }
}

export function isCycle(err: any): err is Cycle {
  return (
    err != null &&
    typeof err === "object" &&
    err.isCycle === true &&
    "terminatingInstance" in err
  );
}
