import type { PgPrimitive } from '@cardstack/runtime-common';

// Row shapes for the two tables the job queue is built on. They live apart
// from the queue itself because everything that reasons about a job's fate
// needs them, and a shared vocabulary module keeps those callers from having
// to import the queue to describe a row.

export interface JobsTable {
  id: number;
  job_type: string;
  concurrency_group: string | null;
  timeout: number;
  priority: number;
  args: PgPrimitive;
  status: 'unfulfilled' | 'resolved' | 'rejected';
  created_at: Date;
  finished_at: Date;
  result: PgPrimitive;
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
