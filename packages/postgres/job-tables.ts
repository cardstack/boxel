import type { PgPrimitive } from '@cardstack/runtime-common';

// Row shapes for the two tables the job queue is built on. They live apart
// from the queue itself because everything that reasons about a job's fate
// needs them, and a shared vocabulary module keeps those callers from having
// to import the queue to describe a row.

export interface JobsTable {
  id: number;
  job_type: string;
  concurrency_group: string | null;
  // The lane family the job's group belongs to, or null for a job published
  // without one. Null, or equal to `concurrency_group`, is the family's
  // exclusive work; anything else is a writer lane. See
  // `QueuePublishRequest.laneFamily`.
  lane_family: string | null;
  timeout: number;
  priority: number;
  args: PgPrimitive;
  // The users whose work this job carries, as a jsonb array. Null on a row
  // from a publish that named none and on one written before the column
  // existed; `awaitRealmIndexSettled` owns what that reads as.
  initiated_by: PgPrimitive;
  status: 'unfulfilled' | 'resolved' | 'rejected';
  created_at: Date;
  finished_at: Date;
  result: PgPrimitive;
}

// A lease holding one concurrency group's jobs un-claimable. See the
// add-job-claim-holds migration for what it is for. The claim query matches it
// against a job's group or its lane family, so a hold naming a family holds
// every lane in it.
export interface JobClaimHoldsTable {
  concurrency_group: string;
  // Half the primary key, with the group. A group is held while any live lease
  // names it, and a holder deletes only the row carrying its own id — a
  // group-wide delete would free the lane out from under every other holder.
  holder_id: string;
  expires_at: Date;
}

export interface JobReservationsTable {
  id: number;
  job_id: number;
  created_at: Date;
  locked_until: Date;
  completed_at: Date;
  worker_id: string;
  // NULL while the reservation is open. On close: 'completed' for a
  // genuine attempt (worker ran the job to a verdict), 'interrupted' for
  // an operational interruption (child crash, manager SIGTERM, scale-in),
  // 'timeout-expired' for the pg-pid reaper path.
  completion_reason: 'completed' | 'interrupted' | 'timeout-expired' | null;
}
