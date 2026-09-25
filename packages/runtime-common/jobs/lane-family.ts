import { param, type Expression } from '../expression.ts';

// How the queue's lanes group into families, in the one form every reader and
// the claim query share. See `QueuePublishRequest.laneFamily` for the model:
// a family's exclusive work runs in a group named for the family, and each of
// its writer lanes is a group of its own that records the family in
// `lane_family`.
//
// A row published without a family reads as exclusive work in a family named
// by its own group. That is every row written before families existed, and
// every job type that never runs in a writer lane, so a family's readers see
// them without anyone having to backfill the column.

// The table qualifier a query refers to `jobs` by. Spelled into the SQL rather
// than bound, so the type enumerates the forms in use instead of taking any
// string.
export type JobsAlias = 'jobs' | 'j' | 'a' | 'p';

// The family a row belongs to.
export function laneFamilyOf(alias: JobsAlias): string {
  return `COALESCE(${alias}.lane_family, ${alias}.concurrency_group)`;
}

// Whether a row is its family's exclusive work rather than a writer lane's.
// Always true or false, never null, since the claim query negates it: a row
// naming a family but no group is a writer lane, not an unknown.
export function isExclusiveLane(alias: JobsAlias): string {
  return `(${alias}.lane_family IS NULL OR ${alias}.lane_family IS NOT DISTINCT FROM ${alias}.concurrency_group)`;
}

// Every job in `family`, whichever lane it runs in: the exclusive work in the
// group named for it, and every writer lane recording it. A reader asking
// about a realm's lane as a whole (is its index behind, cancel its work) wants
// this rather than the group, which names only one lane of the family.
//
// Two equalities rather than `laneFamilyOf(...) = family`, so each side can be
// answered from its own partial index on the queue's live rows.
export function laneFamilyPredicate(
  family: string,
  alias: JobsAlias = 'jobs',
): Expression {
  return [
    `(${alias}.concurrency_group =`,
    param(family),
    `OR ${alias}.lane_family =`,
    param(family),
    `)`,
  ];
}

// `laneFamilyPredicate` over several families at once.
export function laneFamiliesPredicate(
  families: string[],
  alias: JobsAlias = 'jobs',
): Expression {
  if (families.length === 0) {
    // `IN ()` is a syntax error, so the empty set is spelled as a predicate
    // that is simply never true.
    return ['FALSE'];
  }
  let list: Expression = ['('];
  families.forEach((family, index) => {
    if (index > 0) {
      list.push(',');
    }
    list.push(param(family));
  });
  list.push(')');
  return [
    `(${alias}.concurrency_group IN`,
    ...list,
    `OR ${alias}.lane_family IN`,
    ...list,
    `)`,
  ];
}

// The family a lane belongs to, from the values a job was published with.
// Mirrors `laneFamilyOf` for code that holds the values rather than a row.
export function laneFamilyKey(lane: {
  concurrencyGroup: string | null;
  laneFamily?: string | null;
}): string | null {
  return lane.laneFamily ?? lane.concurrencyGroup;
}

// The lane a job is published to: the group it runs in, and the family that
// group belongs to, as `QueuePublishRequest` takes them. Spread into a publish.
export interface Lane {
  concurrencyGroup: string;
  laneFamily: string | null;
}

// A family's exclusive lane: the group named for the family itself, published
// without a family.
export function exclusiveLane(family: string): Lane {
  return { concurrencyGroup: family, laneFamily: null };
}

// The writer lane in `family` that `initiatedBy`'s work runs in. A write
// someone made runs in `#user:<matrix id>`; work nobody initiated (a
// file-watcher echo, system work) runs in `#owner`, since it runs on the realm
// owner's authority. So one writer's own jobs stay in one lane, where they
// coalesce and run in order, and different writers' jobs run side by side.
export function writerLane(
  family: string,
  initiatedBy: string | null | undefined,
): Lane {
  return {
    concurrencyGroup: `${family}${writerLaneSuffix(initiatedBy)}`,
    laneFamily: family,
  };
}

function writerLaneSuffix(initiatedBy: string | null | undefined): string {
  return initiatedBy ? `#user:${initiatedBy}` : '#owner';
}

// The lane in `family` that belongs to the same writer as `lane`, which is how
// a job follows the lane of the job that spawned it into another family. A
// writer lane maps to that writer's lane in `family`; exclusive work, and a
// job with no lane at all, maps to `family`'s exclusive lane.
export function sameWriterLaneIn(
  family: string,
  lane:
    | { concurrencyGroup: string | null; laneFamily?: string | null }
    | undefined,
): Lane {
  let group = lane?.concurrencyGroup;
  let spawnerFamily = lane?.laneFamily;
  if (
    !group ||
    !spawnerFamily ||
    group === spawnerFamily ||
    !group.startsWith(`${spawnerFamily}#`)
  ) {
    return exclusiveLane(family);
  }
  return {
    concurrencyGroup: `${family}${group.slice(spawnerFamily.length)}`,
    laneFamily: family,
  };
}
