// The members of a `callApi` declaration that each declare the request's one
// body: a JSON value, a GraphQL request, or form fields. The decorator,
// lowering and `boxel lint` all read the body members from this list.
export const CALL_API_BODY_KINDS = ['json', 'graphql', 'form'] as const;

export type CallApiBodyKind = (typeof CALL_API_BODY_KINDS)[number];
