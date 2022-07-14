import { methodNotAllowed, notFound } from "./error";
import { RealmPaths } from "./paths";

type Handler = (request: Request) => Promise<Response>;
type Method = "GET" | "POST" | "PATCH" | "DELETE";

function isHTTPMethod(method: any): method is Method {
  if (typeof method !== "string") {
    return false;
  }
  return ["GET", "POST", "PATCH", "DELETE"].includes(method);
}

export class Router {
  #routeTable = new Map<Method, Map<string, Handler>>();
  #paths: RealmPaths;
  constructor(mountURL: URL) {
    this.#paths = new RealmPaths(mountURL);
  }

  get(path: string, handler: Handler): Router {
    this.setRoute("GET", path, handler);
    return this;
  }
  post(path: string, handler: Handler): Router {
    this.setRoute("POST", path, handler);
    return this;
  }
  patch(path: string, handler: Handler): Router {
    this.setRoute("PATCH", path, handler);
    return this;
  }
  delete(path: string, handler: Handler): Router {
    this.setRoute("DELETE", path, handler);
    return this;
  }

  private setRoute(method: Method, path: string, handler: Handler) {
    let routes = this.#routeTable.get(method);
    if (!routes) {
      routes = new Map();
      this.#routeTable.set(method, routes);
    }
    routes.set(path, handler);
  }

  async handle(request: Request): Promise<Response> {
    if (!isHTTPMethod(request.method)) {
      return methodNotAllowed(request);
    }
    let routes = this.#routeTable.get(request.method);
    if (!routes) {
      return notFound(request);
    }

    let requestPath = `/${this.#paths.local(new URL(request.url))}`;
    // add a leading and trailing slashes back so we can match on routing rules for directories.
    requestPath =
      request.url.endsWith("/") && requestPath !== "/"
        ? `${requestPath}/`
        : requestPath;
    for (let [route, handler] of routes) {
      // let's take care of auto escaping '/' and anchoring in our route regex's
      // to make it more readable in our config
      let routeRegExp = new RegExp(`^${route.replace("/", "\\/")}$`);
      if (routeRegExp.test(requestPath)) {
        return await handler(request);
      }
    }
    return notFound(request);
  }
}
