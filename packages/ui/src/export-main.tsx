import React from "react";
import ReactDOM from "react-dom/client";
import SpaceViewer from "./viewer/SpaceViewer";
import type { SpaceOverlay, SpacePayload } from "./space-types";
import "./index.css";

/**
 * Static export entry: the same knowledge-city viewer, fed from ./space.json
 * instead of the local server. Guide Q&A and source reading are disabled —
 * the bundle ships no source code and calls no AI. Personal overlay models
 * travel inside models/ with relative urls.
 */

interface ExportPayload {
  space: SpacePayload["space"];
  layout: SpacePayload["layout"];
  packRoles?: string[];
  overlays?: SpaceOverlay[];
}

const rootEl = document.getElementById("root");

function renderError(message: string): void {
  if (!rootEl) return;
  ReactDOM.createRoot(rootEl).render(
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#252b23",
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
        padding: 24,
        textAlign: "center",
        lineHeight: 1.6
      }}
    >
      <div style={{ maxWidth: 560 }}>
        <div style={{ fontSize: 18, fontWeight: 600 }}>Could not load space.json</div>
        <div style={{ marginTop: 10, fontSize: 14, color: "#535c4e" }}>{message}</div>
        <div style={{ marginTop: 10, fontSize: 13, color: "#535c4e" }}>
          Tip: opening this file via <code>file://</code> does not work — serve the folder over
          HTTP instead, e.g. <code>npx serve .</code>
        </div>
      </div>
    </div>
  );
}

fetch("./space.json")
  .then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json() as Promise<ExportPayload>;
  })
  .then((data) => {
    if (!rootEl) return;
    ReactDOM.createRoot(rootEl).render(
      <React.StrictMode>
        <SpaceViewer
          offline={{
            payload: { space: data.space, layout: data.layout },
            packRoles: data.packRoles ?? [],
            assetBase: "./models/",
            overlays: data.overlays ?? []
          }}
        />
      </React.StrictMode>
    );
  })
  .catch((err: Error) => renderError(err.message));
