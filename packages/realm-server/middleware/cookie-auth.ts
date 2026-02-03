import type { Context, Next } from 'koa';
import { findAuthCookieForPath } from '../utils/auth-cookie';

// State key for injected authorization header - used by fetchRequestFromContext
export const INJECTED_AUTH_HEADER_STATE = 'injectedAuthorizationHeader';

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
    let authHeader = `Bearer ${token}`;
    // Store in state for reliable passing to fetchRequestFromContext
    // This is more reliable than mutating ctx.req.headers which may not persist
    // in all Node.js environments
    (ctx.state as Record<string, unknown>)[INJECTED_AUTH_HEADER_STATE] =
      authHeader;
    // Also set on headers for any middleware that reads directly
    ctx.request.headers.authorization = authHeader;
    ctx.req.headers.authorization = authHeader;
  }

  await next();
};

export default cookieAuthMiddleware;
