// The error every check in the query grammar raises when a query does not
// conform to it, held in a module that imports nothing. `query.ts` and the leaf
// validators it depends on — `json-validation.ts` — both raise it, and this
// module's position under both of them is what guarantees the class is
// initialized before either can throw, whichever of them a consumer loads
// first.
//
// Callers key their response off the class, not the message: the search
// endpoints turn it into a 400 and let anything else surface as a 500, so a
// grammar violation reported as a plain `Error` reads to a caller as a server
// fault rather than a bad request.
export class InvalidQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidQueryError';
  }
}
