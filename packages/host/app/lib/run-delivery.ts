// A background run's result reaches its room as a message the host sends
// for the reader once the run is done. Its client id is derived from the
// run card, so every tab can tell the run has been delivered and the
// transcript can show the message as a delivery rather than as something
// the reader typed.

const PREFIX = 'realm-run-complete:';

export function runDeliveryId(runId: string): string {
  return `${PREFIX}${runId}`;
}

export function isRunDelivery(clientGeneratedId: string | null | undefined) {
  return Boolean(clientGeneratedId?.startsWith(PREFIX));
}
