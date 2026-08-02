export function createHttpRouter(services) {
  const routes = [];

  function register(method, path, options, handler) {
    routes.push({ method, ...compilePath(path), options, handler });
  }

  async function handle({ request, response, url }) {
    const route = routes.find((candidate) => candidate.method === request.method && candidate.pattern.test(url.pathname));
    if (!route) return false;

    const match = url.pathname.match(route.pattern);
    const params = Object.fromEntries(route.paramNames.map((name, index) => [name, decodeURIComponent(match[index + 1])]));
    const context = { request, response, url, params, services };
    const policy = route.options ?? {};

    if (policy.auth === "user") context.user = await services.requireUser(request);
    if (policy.auth === "admin") context.user = await services.requireAdmin(request);
    if (policy.csrf) services.requireCsrf(request);
    if (policy.rateLimit) await services.enforceRateLimit(request, policy.rateLimit, context.user?.id ?? null);
    if (policy.body === "json") context.body = await services.readBody(request);

    const result = await route.handler(context);
    if (result !== undefined) {
      const isResponse = result && typeof result === "object" && ("status" in result || "body" in result);
      services.sendJson(response, isResponse ? result.status ?? 200 : 200, isResponse ? result.body : result);
    }
    return true;
  }

  return {
    get: (path, options, handler) => register("GET", path, options, handler),
    post: (path, options, handler) => register("POST", path, options, handler),
    delete: (path, options, handler) => register("DELETE", path, options, handler),
    handle,
  };
}

function compilePath(path) {
  const paramNames = [];
  const source = path
    .split("/")
    .map((segment) => {
      if (!segment.startsWith(":")) return escapeRegExp(segment);
      paramNames.push(segment.slice(1));
      return "([^/]+)";
    })
    .join("/");
  return { pattern: new RegExp(`^${source}$`), paramNames };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
