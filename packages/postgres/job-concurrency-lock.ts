// Serializes everything that decides a job's fate within one concurrency
// group. The claim path takes it so two workers cannot claim the same job;
// anything that writes an outcome from outside the queue must take the same
// lock, or it races the claim it is trying to avoid stepping on. Exported so
// there is exactly one derivation of the key — a second copy that drifted
// would silently stop excluding anything.
export { acquireConcurrencyGroupLock } from '@cardstack/runtime-common/queue-concurrency-lock';
