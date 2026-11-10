import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { RESOURCES } from "./catalog/resources.mjs";
import { resolveActor } from "./identity/access.mjs";
import { Problem } from "./reservations/problem.mjs";
import { createReservationService } from "./reservations/service.mjs";

const STATIC_FILES = new Map([
  ["/", ["./web/index.html", "text/html; charset=utf-8"]],
  ["/styles.css", ["./web/styles.css", "text/css; charset=utf-8"]],
  ["/client.js", ["./web/client.js", "text/javascript; charset=utf-8"]],
  ["/slot-labels/format.mjs", ["./slot-labels/format.mjs", "text/javascript; charset=utf-8"]],
]);
const MAX_BODY_BYTES = 8 * 1024;

function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const type = request.headers["content-type"]?.split(";")[0]?.trim().toLowerCase();
  if (type !== "application/json") throw new Problem(415, "JSON_REQUIRED", "Send an application/json body.");
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) {
      request.resume();
      throw new Problem(413, "BODY_TOO_LARGE", "The JSON body is larger than 8 KiB.");
    }
    chunks.push(chunk);
  }
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new TypeError("expected an object");
    return data;
  } catch {
    throw new Problem(400, "BAD_JSON", "Send a valid JSON object.");
  }
}

export function createApp({ store, now, id, onError = console.error }) {
  const reservations = createReservationService(store, { now, id });
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://harbor-desk.local");
      const route = `${request.method} ${url.pathname}`;
      const asset = request.method === "GET" && STATIC_FILES.get(url.pathname);
      if (asset) {
        const body = await readFile(new URL(asset[0], import.meta.url));
        response.writeHead(200, { "Content-Type": asset[1], "X-Content-Type-Options": "nosniff" });
        response.end(body);
        return;
      }
      if (route === "GET /api/resources") return json(response, 200, { resources: RESOURCES });
      if (route === "POST /api/quote") return json(response, 200, { quote: reservations.quote(await readJson(request)) });

      const cancellation = request.method === "DELETE" && /^\/api\/reservations\/([a-zA-Z0-9-]+)$/.exec(url.pathname);
      if (route === "GET /api/reservations" || route === "POST /api/reservations" || route === "GET /api/mailbox" || cancellation) {
        const actor = resolveActor(request.headers["x-harbor-user"]);
        if (!actor) throw new Problem(401, "IDENTITY_REQUIRED", "Choose a known Harbor Desk demo identity.");
        if (route === "GET /api/reservations") return json(response, 200, { reservations: reservations.list(actor) });
        if (route === "POST /api/reservations") return json(response, 201, { reservation: reservations.create(actor, await readJson(request)) });
        if (route === "GET /api/mailbox") return json(response, 200, { messages: store.listMailbox(actor.id) });
        return json(response, 200, { reservation: reservations.cancel(actor, cancellation[1]) });
      }
      throw new Problem(404, "ROUTE_UNKNOWN", "This endpoint does not exist.");
    } catch (error) {
      if (error instanceof Problem) return json(response, error.status, { error: error.code, message: error.message });
      onError(error);
      return json(response, 500, { error: "UNEXPECTED", message: "Harbor Desk could not complete the request." });
    }
  });
}
