import { Context, Next } from 'koa';
import qs from 'qs';

const convertAcceptHeaderMiddleware = async (
  ctx: Context,
  next: Next,
): Promise<void> => {
  const acceptHeader = Array.isArray(ctx.query.acceptHeader)
    ? ctx.query.acceptHeader.join(',')
    : ctx.query.acceptHeader;
  if (acceptHeader) {
    ctx.request.headers.accept = acceptHeader; // Set Accept header on request object
    delete ctx.query.acceptHeader; // Remove acceptHeader query parameter
    ctx.search = '?' + qs.stringify(ctx.query);
    ctx.url = ctx.url.split('?')[0] + ctx.search;
  }
  await next(); // Allow subsequent middleware to run
};

export default convertAcceptHeaderMiddleware;
