import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { startServer } from "../dist/index.js";

function send(server, path, { method = "GET", headers = {}, payload } = {}) {
  const body = payload === undefined ? undefined : JSON.stringify(payload);
  const requestHeaders = body === undefined ? headers : {
    ...headers,
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body)
  };

  // Node's HTTP client lets the test send an arbitrary Host to the loopback listener.
  return new Promise((resolve, reject) => {
    const req = request(new URL(path, server.url), {
      method,
      headers: requestHeaders,
      agent: false,
      signal: AbortSignal.timeout(5000)
    }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { text += chunk; });
      res.on("error", reject);
      res.on("end", () => resolve({ status: res.statusCode, body: text }));
    });
    req.on("error", reject);
    req.end(body);
  });
}

test("the local listener rejects foreign requests before accessing workspaces", async (t) => {
  const tempDir = await realpath(tmpdir());
  const fixture = await mkdtemp(join(tempDir, "kodyurd-local-http-"));
  assert.equal(dirname(fixture), tempDir);

  let server;
  t.after(async () => {
    try {
      await server?.close();
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  const uiDist = join(fixture, "ui");
  const sourceDir = join(fixture, "workspace");
  await mkdir(uiDist);
  await mkdir(sourceDir);
  await writeFile(join(uiDist, "index.html"), "<title>Kodyurd test UI</title>");

  server = await startServer({ port: 0, dataDir: join(fixture, "data"), uiDist });
  assert.ok(server.port > 0);
  assert.equal(server.url, `http://127.0.0.1:${server.port}`);

  const projectsPath = "/api/projects";
  const localhost = `localhost:${server.port}`;
  const foreignHost = `foreign.example:${server.port}`;
  const foreignOrigin = "https://foreign.example";
  const wrongPort = server.port === 4717 ? 4718 : 4717;
  const navigation = await send(server, "/", {
    headers: { "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate" }
  });
  assert.equal(navigation.status, 200);
  assert.match(navigation.body, /Kodyurd test UI/);
  assert.equal((await send(server, "/", { headers: { host: foreignHost } })).status, 403);

  const normalRead = await send(server, projectsPath);
  assert.equal(normalRead.status, 200);
  assert.deepEqual(JSON.parse(normalRead.body), { projects: [] });
  const localhostRead = await send(server, projectsPath, {
    headers: { host: localhost, origin: `http://${localhost}` }
  });
  assert.equal(localhostRead.status, 200);

  const rejectedReads = [
    ["foreign Host without Origin", { host: foreignHost }],
    ["matching foreign Host and Origin", { host: foreignHost, origin: `http://${foreignHost}` }],
    ["loopback Host with the wrong port", { host: `127.0.0.1:${wrongPort}` }],
    ["foreign Origin", { origin: foreignOrigin }],
    ["opaque Origin", { origin: "null" }],
    ["localhost Origin for a numeric loopback Host", { origin: `http://${localhost}` }],
    ["loopback Origin with the wrong port", { origin: `http://127.0.0.1:${wrongPort}` }],
    ["cross-site API request without Origin", { "sec-fetch-site": "cross-site" }],
    ["same-site API request without Origin", { "sec-fetch-site": "same-site" }]
  ];
  for (const [label, headers] of rejectedReads) {
    assert.equal((await send(server, projectsPath, { headers })).status, 403, label);
  }

  const created = await send(server, projectsPath, {
    method: "POST",
    headers: { origin: server.url, "sec-fetch-site": "same-origin" },
    payload: { name: "Local test workspace", sourceDir }
  });
  assert.equal(created.status, 200, created.body);
  const { project } = JSON.parse(created.body);
  assert.equal(project.name, "Local test workspace");

  const workspacePath = `${projectsPath}/${project.id}`;
  const refused = await send(server, workspacePath, {
    method: "DELETE",
    headers: { origin: foreignOrigin, "sec-fetch-site": "cross-site" }
  });
  assert.equal(refused.status, 403);
  const remaining = await send(server, workspacePath);
  assert.equal(remaining.status, 200);
  assert.equal(JSON.parse(remaining.body).project.id, project.id);
});
