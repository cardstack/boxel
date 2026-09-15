// Capability contracts at the existing boundaries. Adapters may implement
// them separately; there is no second queue or mandatory orchestration layer.

export interface LatticeChangeCapture<Transaction, Change> {
  // Capture old/new identity facts with the source commit. A Change may be a
  // reference to a durable batch; copying its complete bodies into JS is not
  // required. Reverse matching may run later against that retained evidence.
  recordChange(tx: Transaction, change: Change): Promise<void>;
}

export interface LatticeProducerRegistration<Transaction, Producer> {
  // Replace this owner's declared inputs atomically with its publication.
  // Retirement removes registrations; an empty query remains a watched input.
  registerProducer(tx: Transaction, producer: Producer): Promise<void>;
}

export interface LatticeRead<Request, Publication> {
  // Authorization belongs to the serving adapter. Undefined means this
  // capability has no artifact; a pending value is explicitly marked pending.
  // Have can omit a known body, never establish coverage or authority.
  read(request: Request): Promise<Publication | undefined>;
}

export type LatticeApplyResult<Instance> =
  | { status: 'applied' | 'ignored'; instance: Instance }
  | { status: 'missing' };

export interface LatticeReplica<Instance, Publication, Context> {
  // Context is local adapter authority, never supplied by the wire payload.
  // Do not read/repair publication bodies here: return a miss to the reader.
  // Presentation definition loading remains the replica adapter’s responsibility.
  // Applying data preserves identity/drafts; changed definitions may require
  // the existing adapter's explicit type-replacement behavior.
  applyPublication(
    instance: Instance,
    publication: Publication,
    context: Context,
  ): Promise<LatticeApplyResult<Instance>>;
}

export interface LatticePublicationStorage<Transaction, Publication> {
  // The caller supplies its pinned transaction. Validate the shared decision
  // and adapter-specific input/code/authority receipts before writing. False
  // means obsolete work, throws mean failure. Neither may clear dirty work.
  // Persist any delivery obligation in this same transaction; no network I/O.
  publish(tx: Transaction, publication: Publication): Promise<boolean>;
}

export interface LatticeExecution<Request, StagedResult> {
  // Undefined is unsupported admission, not a failed computation. Once
  // admitted, errors propagate. Results remain staged: execution never makes
  // them current and must preserve their final publication checks.
  execute(request: Request): Promise<StagedResult | undefined>;
}

export interface LatticeDelivery<Notice> {
  // A committed notice is a wake-up hint, not a new source of truth. The
  // recipient is already authorized by the adapter. Sending can repeat;
  // returns a transport receipt, never a publication/validity receipt.
  send(
    realmURL: string,
    recipient: string,
    notice: Notice,
    signal: AbortSignal,
  ): Promise<string>;
}
