import { methodNotAllowed, notFound } from "./error";

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

    for (let [route, handler] of routes) {
      let routeRegExp = new RegExp(route.replace("/", "\\/")); // let's take care of auto escaping '/' in our route regex's to make it more readable
      if (routeRegExp.test(new URL(request.url).pathname)) {
        return await handler(request);
      }
    }
    return notFound(request);
  }
}
