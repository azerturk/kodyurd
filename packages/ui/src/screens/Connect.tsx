import { useEffect, useState } from "react";
import { api, type AgentId, type AgentInfo, type KeysInfo } from "../api";

const AGENTS: { id: AgentId; name: string; description: string }[] = [
  { id: "claude", name: "Claude Code", description: "Uses the Claude Code CLI and your existing login." },
  { id: "codex", name: "Codex CLI", description: "Uses the Codex CLI and your existing login." },
  { id: "api", name: "Anthropic API", description: "Uses the evidence Kodyurd collects locally and your Anthropic API key." }
];

function displayPreference<T extends string>(key: string, choices: readonly T[], fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return choices.find((choice) => choice === value) ?? fallback;
  } catch { return fallback; }
}

const SCALES = ["1", "1.15", "1.3"] as const;
const MOTIONS = ["system", "reduce", "full"] as const;

export default function Connect({ preferredAgent, hasWorkspace, onScaleChange, onContinue }: {
  preferredAgent?: AgentId;
  hasWorkspace: boolean;
  onScaleChange: (scale: number) => void;
  onContinue: (agent?: AgentId) => void;
}) {
  const [agents, setAgents] = useState<AgentInfo[] | null>(null);
  const [keys, setKeys] = useState<KeysInfo | null>(null);
  const [anthropicKey, setAnthropicKey] = useState("");
  const [tripoKey, setTripoKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [selectedAgent, setSelectedAgent] = useState(preferredAgent);
  const [editor, setEditor] = useState<Awaited<ReturnType<typeof api.editor>> | null>(null);
  const [checkingEditor, setCheckingEditor] = useState(false);
  const [checkingApi, setCheckingApi] = useState(false);
  const [connection, setConnection] = useState<{ ok: boolean; message: string } | null>(null);
  const [scale, setScale] = useState(() => displayPreference("kodyurd:text-scale", SCALES, "1"));
  const [motion, setMotion] = useState(() => displayPreference("kodyurd:motion", MOTIONS, "system"));

  useEffect(() => {
    let current = true;
    Promise.all([api.agents(), api.keys()]).then(([detected, configured]) => {
      if (!current) return;
      setAgents(detected.agents);
      setKeys(configured);
    }).catch((err: Error) => { if (current) setError(err.message); });
    api.editor().then((status) => { if (current) setEditor(status); }).catch(() => undefined);
    return () => { current = false; };
  }, []);

  const activeAgent = selectedAgent ?? agents?.find((agent) => agent.available)?.id;
  const activeReady = activeAgent === "api" ? keys?.anthropic : agents?.some((agent) => agent.id === activeAgent && agent.available);

  function checkEditor(): void {
    setCheckingEditor(true);
    api.editor().then(setEditor).catch((err: Error) => setError(err.message))
      .finally(() => setCheckingEditor(false));
  }

  function save(kind: "anthropic" | "tripo"): void {
    setSaving(true);
    setError(null);
    setSaved(null);
    api.saveKeys(kind === "anthropic" ? { anthropicKey: anthropicKey.trim() } : { tripoKey: tripoKey.trim() })
      .then((configured) => {
        setKeys(configured);
        if (kind === "anthropic") {
          setAnthropicKey("");
          setConnection(null);
          setAgents((existing) => existing?.map((item) =>
            item.id === "api" ? { ...item, available: configured.anthropic } : item
          ) ?? null);
        } else {
          setTripoKey("");
        }
        setSaved(kind === "anthropic" ? "Anthropic key saved." : "Tripo key saved.");
      }).catch((err: Error) => setError(err.message)).finally(() => setSaving(false));
  }

  function checkAnthropic(): void {
    setCheckingApi(true);
    setConnection(null);
    api.checkAnthropic().then(() => setConnection({ ok: true, message: "Anthropic accepted the configured key." }))
      .catch((err: Error) => setConnection({ ok: false, message: err.message })).finally(() => setCheckingApi(false));
  }

  return (
    <main className="studio-main">
      <div className="studio-heading">
        <div>
          <p className="studio-eyebrow">Local studio</p>
          <h1>Settings</h1>
          <p>Connect an agent for generation and Guide questions.</p>
        </div>
        <button type="button" className="studio-button" onClick={() => onContinue()}>{hasWorkspace ? "Back to workspace" : "Back to workspaces"}</button>
      </div>
      {error && <p role="alert" className="studio-alert">{error}</p>}
      {saved && <p role="status" className="studio-scan">{saved}</p>}
      <section className="studio-panel">
        <h2>Connect an agent</h2>
        <ul className="studio-agent-list">
          {AGENTS.map(({ id, name, description }) => {
            const detected = agents?.find((agent) => agent.id === id);
            const ready = id === "api" ? keys?.anthropic : detected?.available;
            const status = ready ? id === "api" ? connection?.ok ? "Connection checked" : "Key configured" : "CLI installed"
              : agents ? id === "api" ? "Key required" : "CLI unavailable" : "Checking";
            return (
              <li key={id}>
                <label className="studio-agent-option" data-selected={activeAgent === id}>
                  <input type="radio" name="studio-agent" checked={activeAgent === id}
                    disabled={!ready} onChange={() => setSelectedAgent(id)} />
                  <span>
                    <strong>{name}</strong>
                    <small>{description}</small>
                  </span>
                  <span className={`studio-status studio-status-${ready ? "ready" : "pending"}`}>
                    {status}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
        <p className="studio-muted">CLI providers use your existing login. The Anthropic connection check sends a model-list request with the configured key.</p>
        <div className="studio-actions">
          <button type="button" className="studio-button studio-primary" disabled={!activeReady}
            onClick={() => onContinue(activeAgent)}>Use agent</button>
        </div>
      </section>
      <div className="studio-grid studio-settings-keys">
        <form className="studio-panel" onSubmit={(event) => { event.preventDefault(); save("anthropic"); }}>
          <h2>Anthropic key {keys?.anthropic && <span className="studio-status studio-status-ready">Set</span>}</h2>
          <p className="studio-muted">Stored locally and sent to Anthropic for your own requests.</p>
          {keys?.anthropicSource && <p className="studio-muted">In use · {keys.anthropicSource === "environment" ? "ANTHROPIC_API_KEY environment variable" : "Local Kodyurd configuration"}</p>}
          <label className="studio-field">API key
            <input type="password" autoComplete="off" value={anthropicKey}
              onChange={(event) => setAnthropicKey(event.target.value)} />
          </label>
          <div className="studio-key-actions">
            <button type="submit" className="studio-button" disabled={saving || !anthropicKey.trim()}>Save key</button>
            <button type="button" className="studio-button" disabled={!keys?.anthropic || saving || checkingApi} onClick={checkAnthropic}>
              {checkingApi ? "Checking…" : "Check connection"}</button>
          </div>
          {connection && <p role="status" className={connection.ok ? "studio-ok" : "studio-alert"}>{connection.message}</p>}
        </form>
        <form className="studio-panel" onSubmit={(event) => { event.preventDefault(); save("tripo"); }}>
          <h2>Tripo key {keys?.tripo && <span className="studio-status studio-status-ready">Set</span>}</h2>
          <p className="studio-muted">Use it to request individual personal overlays after generation.</p>
          {keys?.tripoSource && <p className="studio-muted">In use · {keys.tripoSource === "environment" ? "TRIPO_API_KEY environment variable" : "Local Kodyurd configuration"}</p>}
          <label className="studio-field">API key
            <input type="password" autoComplete="off" value={tripoKey}
              onChange={(event) => setTripoKey(event.target.value)} />
          </label>
          <button type="submit" className="studio-button" disabled={saving || !tripoKey.trim()}>Save key</button>
        </form>
      </div>
      <div className="studio-grid studio-settings-keys">
        <section className="studio-panel">
          <div className="studio-section-title">
            <h2>Editor</h2>
            <button className="studio-button studio-small" type="button" onClick={checkEditor}
              disabled={checkingEditor}>{checkingEditor ? "Checking…" : "Check editor"}</button>
          </div>
          <p className="studio-muted" role="status">
            {editor ? `${editor.name} · ${editor.detail}` : "Looking for an editor executable…"}
          </p>
          <p className="studio-muted">Source Inspector can also copy a validated file and line.</p>
          <p className="studio-muted">Check editor detects the executable. To test a specific line, open it from a source card.</p>
        </section>
        <section className="studio-panel studio-display-options">
          <h2>Display</h2>
          <label className="studio-field">Text size
            <select value={scale} onChange={(event) => {
              const next = event.target.value as typeof scale;
              setScale(next);
              onScaleChange(Number(next));
              try { localStorage.setItem("kodyurd:text-scale", next); } catch { /* session choice */ }
            }}>
              <option value="1">Standard</option><option value="1.15">Large</option><option value="1.3">Extra large</option>
            </select>
          </label>
          <label className="studio-field">Motion
            <select value={motion} onChange={(event) => {
              const next = event.target.value as typeof motion;
              setMotion(next);
              try { localStorage.setItem("kodyurd:motion", next); } catch { /* session choice */ }
            }}>
              <option value="system">Use system preference</option><option value="reduce">Reduced motion</option><option value="full">Full motion</option>
            </select>
          </label>
          <details className="studio-options"><summary>Keyboard and navigation</summary>
            <p className="studio-muted">WASD or the up and down arrows walk, the left and right arrows turn the view, E opens a nearby station, M shows the city map, and Tab opens the city menu. Diagram indexes provide keyboard access to components and links.</p>
          </details>
        </section>
      </div>
    </main>
  );
}
