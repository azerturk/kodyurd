import { fileURLToPath, URL } from "node:url";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const root = fileURLToPath(new URL(".", import.meta.url));
const apiTarget = new URL("http://127.0.0.1:4717");

export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  server: {
    host: "127.0.0.1",
    proxy: {
      "/api": {
        target: apiTarget.origin,
        configure(proxy) {
          proxy.on("proxyReq", (outgoing, incoming) => {
            const port = incoming.socket.localPort;
            const [host, duplicateHost] = incoming.headersDistinct.host ?? [];
            const authority = host?.toLowerCase();
            const localHost = ["127.0.0.1", "localhost"].some(
              (name) => authority === `${name}:${port}` || (port === 80 && authority === name)
            );
            if (port === undefined || duplicateHost !== undefined || !localHost) return;

            // Forward this dev server's own requests as same-origin API requests.
            outgoing.setHeader("host", apiTarget.host);
            if (incoming.headers.origin === new URL(`http://${authority}`).origin) {
              outgoing.setHeader("origin", apiTarget.origin);
            }
          });
        }
      }
    }
  },
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        main: resolve(root, "index.html"),
        export: resolve(root, "export.html")
      },
      output: {
        manualChunks(id) {
          if (id.includes("/node_modules/playcanvas/")) return "playcanvas";
        }
      }
    }
  }
});
