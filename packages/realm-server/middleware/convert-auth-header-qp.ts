import { Context, Next } from 'koa';
import qs from 'qs';

const convertAuthHeaderMiddleware = async (
  ctx: Context,
  next: Next,
): Promise<void> => {
  const authHeader = Array.isArray(ctx.query.authHeader)
    ? ctx.query.authHeader[0]
    : ctx.query.authHeader;
  if (authHeader) {
    ctx.request.headers.authorization = authHeader; // Set Auth header on request object
    delete ctx.query.authHeader; // Remove authHeader query parameter
    ctx.search = '?' + qs.stringify(ctx.query);
    ctx.url = ctx.url.split('?')[0] + ctx.search;
  }
  await next(); // Allow subsequent middleware to run
};

export default convertAuthHeaderMiddleware;
