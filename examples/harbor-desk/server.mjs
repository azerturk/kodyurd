import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.mjs";
import { createNotificationWorker } from "./notifications/worker.mjs";
import { openStore } from "./persistence/database.mjs";

const port = Number(process.env.PORT ?? 4724);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be an integer between 1 and 65535.");

const databaseFile = process.env.HARBOR_DB
  ? resolve(process.env.HARBOR_DB)
  : fileURLToPath(new URL("./.data/harbor.sqlite", import.meta.url));
mkdirSync(dirname(databaseFile), { recursive: true });
const store = openStore(databaseFile);
const server = createApp({ store });
const failFirstAttempt = process.env.HARBOR_DEMO_NOTIFY_FAIL_ONCE === "1";
const worker = createNotificationWorker(store, { simulateDelivery: (_message, attempt) => !failFirstAttempt || attempt > 1 });
let stopWorker;

server.listen(port, "127.0.0.1", () => {
  stopWorker = worker.start();
  console.log(`Harbor Desk is available at http://127.0.0.1:${port}`);
});
server.once("close", () => {
  stopWorker?.();
  store.close();
});
process.once("SIGINT", () => server.close());
process.once("SIGTERM", () => server.close());
