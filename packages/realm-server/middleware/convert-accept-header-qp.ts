import { Context, Next } from 'koa';

const convertAcceptHeaderMiddleware = async (
  ctx: Context,
  next: Next
): Promise<void> => {
  const acceptHeader = Array.isArray(ctx.query.acceptHeader)
    ? ctx.query.acceptHeader.join(',')
    : ctx.query.acceptHeader;
  if (acceptHeader) {
    ctx.request.headers.accept = acceptHeader; // Set Accept header on request object
    delete ctx.query.acceptHeader; // Remove acceptHeader query parameter
  }
  await next(); // Allow subsequent middleware to run
};

export default convertAcceptHeaderMiddleware;
