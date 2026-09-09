// The error every check in the query grammar raises when a query does not
// conform to it. It lives apart from `query.ts` so the leaf validators
// `query.ts` itself depends on — `json-validation.ts` — can raise it without a
// module cycle.
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
