export class JqError extends Error {}
export class JqParseError extends JqError {}
export class JqPrintError extends JqError {}
export class JqEvaluateError extends JqError {}
export class JqArgumentError extends JqEvaluateError {}
export class NotImplementedError extends JqEvaluateError {}
