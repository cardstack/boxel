import type { Context, Next } from 'koa';
import { findAuthCookieForPath } from '../utils/auth-cookie';

/**
 * Middleware that converts auth cookies to Authorization headers
 * ONLY for GET and HEAD requests (read-only operations)
 *
 * Security model:
 * - Cookies work only for GET/HEAD operations (read-only)
 * - Mutating requests (POST, PUT, DELETE, PATCH) must still use Authorization headers
 * - This prevents CSRF attacks since browsers can't forge Authorization headers
 * - HttpOnly cookies prevent XSS token theft
 * - SameSite=Lax provides additional CSRF protection
 */
const cookieAuthMiddleware = async (
  ctx: Context,
  next: Next,
): Promise<void> => {
  // Only apply to GET and HEAD requests (read-only operations)
  if (ctx.method !== 'GET' && ctx.method !== 'HEAD') {
    await next();
    return;
  }

  // Skip if Authorization header is already present
  if (ctx.request.headers.authorization) {
    await next();
    return;
  }

  // Try to find an auth cookie that matches the request path
  let cookieHeader = ctx.request.headers.cookie;
  let token = findAuthCookieForPath(cookieHeader, ctx.request.path);

  if (token) {
    // Inject the token as an Authorization header for downstream middleware
    // We need to set it on both ctx.request.headers (Koa) and ctx.req.headers (Node.js)
    // because fetchRequestFromContext uses ctx.req.headers when building the Request
    let authHeader = `Bearer ${token}`;
    ctx.request.headers.authorization = authHeader;
    ctx.req.headers.authorization = authHeader;
  }

  await next();
};

export default cookieAuthMiddleware;
