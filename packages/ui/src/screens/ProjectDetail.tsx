import { useCallback, useEffect, useState } from "react";
import {
  api, LocalApiError, type AgentId, type AgentInfo, type AnalyzerReport, type JobView, type OverlayItem, type Project,
  type ScanExclusion, type SpaceOffer
} from "../api";
import GenerationPanel, { focusTitle, isRunning } from "./GenerationPanel";
import SavedCities from "./SavedCities";
import StudioDialog from "./StudioDialog";

interface EvidenceChanges {
  checked: number;
  changed: { id: string; title: string; paths: string[] }[];
}

const AGENT_LABELS: Record<AgentId, string> = {
  claude: "Claude Code",
  codex: "Codex CLI",
  api: "Anthropic API"
};

const LANGUAGE_LABELS: Record<string, string> = {
  en: "English", az: "Azerbaijani", tr: "Turkish", ru: "Russian", es: "Spanish", de: "German"
};

const SCAN_EXCLUSIONS: Record<ScanExclusion["reason"], string> = {
  "ignore-rule": "Workspace ignore rule",
  generated: "Generated output or local database",
  hidden: "Hidden directory",
  link: "Symbolic link",
  unreadable: "Unreadable entry"
};

const draftKey = (projectId: string): string => `kodyurd:brief:${projectId}`;
const lessonModuleLine = /^[ \t]*Lesson modules:[ \t]*([^\r\n]*)/im;
// One focus and up to nine pinned modules fit the ten lessons a job builds.
const pinnedLessonLimit = 9;

function readDraft(projectId: string): string | null {
  try { return localStorage.getItem(draftKey(projectId)); } catch { return null; }
}

function ScanDetails({ report }: { report: AnalyzerReport }) {
  const limits = report.scanLimits;
  if (!limits) return null;
  return (
    <details className="studio-options studio-scan-details">
      <summary>Scan limits and exclusions <span>{limits.excludedEntries.toLocaleString()} skipped</span></summary>
      <dl className="studio-scan-budgets">
        <div data-reached={limits.reached.includes("files")}><dt>Files</dt><dd>{report.totals.files.toLocaleString()} / {limits.files.toLocaleString()}</dd></div>
        <div data-reached={limits.reached.includes("docs")}><dt>Documents</dt><dd>{report.docs.length.toLocaleString()} / {limits.docs.toLocaleString()}</dd></div>
        <div data-reached={limits.reached.includes("depth")}><dt>Folder depth limit</dt><dd>{limits.depth}</dd></div>
      </dl>
      {limits.reached.length > 0 && <p className="studio-muted">Reached {limits.reached.map((limit) =>
        limit === "depth" ? "folder depth limit" : `${limit === "docs" ? "document" : "file"} limit`).join(", ")}.</p>}
      {!!limits.exclusions?.length && <ul className="studio-scan-exclusions">
        {limits.exclusions.map(({ reason, count, examples }) => (
          <li key={reason}>
            <strong>{SCAN_EXCLUSIONS[reason]} · {count.toLocaleString()}</strong>
            {!!examples.length && <span>{examples.join(", ")}</span>}
          </li>
        ))}
      </ul>}
    </details>
  );
}

export default function ProjectDetail({
  id, preferredAgent, agentOverride, onWorkspace, onWalkSpace, onPreview, onRemoved
}: {
  id: string;
  preferredAgent?: AgentId;
  agentOverride?: AgentId;
  onWorkspace: (hasSpace: boolean) => void;
  onWalkSpace: (artifact?: string) => void;
  onPreview: (jobId: string, artifact?: string) => void;
  onRemoved: (cleanupPending?: boolean) => void;
}) {
  const [project, setProject] = useState<Project | null>(null);
  const [report, setReport] = useState<AnalyzerReport | null>(null);
  const [hasSpace, setHasSpace] = useState(false);
  const [brief, setBrief] = useState(() => readDraft(id) ?? "");
  const [language, setLanguage] = useState("en");
  const [agent, setAgent] = useState<AgentId | undefined>(agentOverride ?? preferredAgent);
  const [model, setModel] = useState("");
  const [focusModule, setFocusModule] = useState("");
  const [inventoryQuery, setInventoryQuery] = useState("");
  const [refreshScan, setRefreshScan] = useState(true);
  const [reuseCache, setReuseCache] = useState(true);
  const [agents, setAgents] = useState<AgentInfo[] | null>(null);
  const [job, setJob] = useState<JobView | null>(null);
  const [screen, setScreen] = useState<"brief" | "job">("brief");
  const [busy, setBusy] = useState(false);
  const [rescanning, setRescanning] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"review" | "export" | "cache" | "remove" | null>(null);
  const [maintaining, setMaintaining] = useState(false);
  const [pollError, setPollError] = useState(false);
  const [offers, setOffers] = useState<SpaceOffer[]>([]);
  const [overlays, setOverlays] = useState<OverlayItem[]>([]);
  const [savingOverlay, setSavingOverlay] = useState(false);
  const [tripo, setTripo] = useState(false);
  const [checkingEvidence, setCheckingEvidence] = useState(false);
  const [evidenceChanges, setEvidenceChanges] = useState<EvidenceChanges | null>(null);

  const loadOffers = useCallback((): void => {
    api.offers(id).then((data) => setOffers(data.offers)).catch(() => undefined);
    api.overlays(id, true).then((data) => setOverlays(data.items)).catch(() => undefined);
    api.keys().then((data) => setTripo(data.tripo)).catch(() => undefined);
  }, [id]);

  useEffect(() => {
    let current = true;
    const fail = (err: Error): void => { if (current) setError(err.message); };
    api.project(id).then((data) => {
      if (!current) return;
      setProject(data.project);
      setHasSpace(data.hasSpace);
      const initialJob = isRunning(data.latestJob) ? data.latestJob : data.latestGenerationJob ?? data.latestJob;
      setJob(initialJob);
      if (initialJob && (!data.hasSpace || isRunning(initialJob) || initialJob.quality?.status === "partial")) setScreen("job");
      if (data.generation) {
        setBrief(readDraft(id) ?? data.generation.brief);
        setLanguage(data.generation.language);
        setAgent(agentOverride ?? data.generation.agent);
        setModel(agentOverride && agentOverride !== data.generation.agent ? "" : data.generation.model ?? "");
        setFocusModule(data.generation.focusModule ?? "");
        setRefreshScan(data.generation.refreshScan ?? true);
        setReuseCache(data.generation.reuseCache ?? true);
      }
    }).catch(fail);
    api.analysis(id).then((data) => { if (current) setReport(data.report); }).catch((err: Error) => {
      if (!(err instanceof LocalApiError && err.status === 409)) fail(err);
    });
    api.agents().then((data) => { if (current) setAgents(data.agents); }).catch((err: Error) => {
      if (current) setAgents([]);
      fail(err);
    });
    return () => { current = false; };
  }, [id, agentOverride]);

  useEffect(() => { onWorkspace(hasSpace); }, [hasSpace, onWorkspace]);
  useEffect(() => { if (hasSpace) loadOffers(); }, [hasSpace, loadOffers]);

  const activeJobId = isRunning(job) ? job?.id : undefined;
  useEffect(() => {
    if (!activeJobId) return;
    let current = true;
    let timer: number | undefined;
    const poll = async (): Promise<void> => {
      try {
        const { job: latest } = await api.job(activeJobId);
        const [scan, workspace] = latest.status === "done" && latest.kind === "space"
          ? await Promise.all([api.analysis(id).catch(() => null), api.project(id).catch(() => null)])
          : [null, null];
        if (!current) return;
        setPollError(false);
        setJob(latest);
        if (latest.focusReady) setHasSpace(true);
        if (!isRunning(latest)) {
          if (latest.status === "done") {
            if (latest.kind === "space") {
              if (workspace) setHasSpace(workspace.hasSpace);
              if (scan) setReport(scan.report);
            }
            loadOffers();
          }
          return;
        }
      } catch {
        if (!current) return;
        setPollError(true);
      }
      if (current) timer = window.setTimeout(poll, 1500);
    };
    void poll();
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [activeJobId, id, loadOffers]);

  const selectedAgent = agent ?? agents?.find((item) => item.available && item.implemented)?.id ?? "claude";
  const available = agents?.some((item) => item.id === selectedAgent && item.available && item.implemented) ?? false;
  const generating = busy || isRunning(job);
  const operationBusy = generating || rescanning || exporting || maintaining || savingOverlay;
  const sameSlot = (left: { building: string; class: string }, right: { building: string; class: string }) =>
    left.building === right.building && left.class === right.class;
  const assetRows = [
    ...offers.map((offer, index) => ({ offer, index, overlay: overlays.find((item) => sameSlot(item, offer)) })),
    ...overlays.filter((item) => !offers.some((offer) => sameSlot(item, offer))).map((overlay) => ({
      offer: undefined, index: undefined, overlay
    }))
  ];
  const focusHints = report?.modules
    .map((module) => module.name.split("/").at(-1) ?? module.name)
    .filter((name) => name.length >= 4 && brief.toLowerCase().includes(name.toLowerCase()))
    .sort((a, b) => b.length - a.length) ?? [];
  const inventoryTerm = inventoryQuery.trim().toLocaleLowerCase();
  const matchesInventory = (value: string): boolean => value.toLocaleLowerCase().includes(inventoryTerm);
  const docsFor = (module: string) => report?.docs.filter((doc) => doc.module === module) ?? [];
  const inventoryModules = report?.modules.filter((module) => matchesInventory(module.name) || docsFor(module.name).some((doc) => matchesInventory(`${doc.path} ${doc.title ?? ""}`))) ?? [];
  const unmappedDocs = report?.docs.filter((doc) => !doc.module && matchesInventory(`${doc.path} ${doc.title ?? ""}`)) ?? [];
  const validFocus = !focusModule || Boolean(report?.modules.some((module) => module.name === focusModule));
  const lessonModules = brief.match(lessonModuleLine)?.[1].split(",").map((name) => name.trim()).filter(Boolean) ?? [];

  function updateBrief(value: string): void {
    setBrief(value);
    try { localStorage.setItem(draftKey(id), value); } catch { /* keep the draft in this view */ }
  }

  function toggleLessonModule(name: string): void {
    const selected = lessonModules.includes(name);
    if (!selected && lessonModules.length >= pinnedLessonLimit) return;
    const next = selected ? lessonModules.filter((module) => module !== name) : [...lessonModules, name];
    const line = next.length ? `Lesson modules: ${next.join(", ")}` : "";
    const updated = lessonModuleLine.test(brief) ? brief.replace(lessonModuleLine, () => line).trimEnd()
      : [brief.trimEnd(), line].filter(Boolean).join("\n");
    if (updated.length <= 2000) updateBrief(updated);
  }

  function start(kind: "space" | "overlay", request: Promise<{ jobId: string }>, submittedBrief = false): void {
    setBusy(true);
    setError(null);
    setNotice(null);
    request.then(({ jobId }) => {
      if (submittedBrief) {
        try { localStorage.removeItem(draftKey(id)); } catch { /* submitted settings are stored on the server */ }
      }
      const at = new Date().toISOString();
      setJob({ id: jobId, projectId: id, kind, status: "queued", stages: [], createdAt: at, updatedAt: at });
      setScreen("job");
    }).catch((err: Error) => {
      setError(err.message);
      void api.project(id).then(({ latestJob }) => {
        if (isRunning(latestJob)) {
          setJob(latestJob);
          setScreen("job");
        }
      }).catch(() => undefined);
    }).finally(() => setBusy(false));
  }

  function rescan(): void {
    setRescanning(true);
    setError(null);
    setNotice(null);
    api.analysis(id, true).then(({ report }) => setReport(report))
      .catch((err: Error) => setError(err.message)).finally(() => setRescanning(false));
  }

  function maintain(action: "cache" | "remove"): void {
    if (operationBusy) return;
    setMaintaining(true);
    setError(null);
    setNotice(null);
    const request = action === "cache" ? api.clearGenerationCache(id) : api.removeWorkspace(id);
    request.then((result) => {
      setDialog(null);
      if (action === "remove") {
        try { localStorage.removeItem(draftKey(id)); } catch { /* server removal still succeeded */ }
        onRemoved("cleanupPending" in result && result.cleanupPending === true);
      } else {
        setRefreshScan(true);
        setNotice("Generation cache cleared. Your saved city and brief are still available.");
      }
    }).catch((err: Error) => { setDialog(null); setError(err.message); }).finally(() => setMaintaining(false));
  }

  function generate(): void {
    if (!project || !report || operationBusy || !available || !validFocus) return;
    setDialog(null);
    setEvidenceChanges(null);
    start("space", api.startSpace(id, {
      brief, language, agent: selectedAgent, model: model.trim() || undefined, focusModule: focusModule || null, fresh: !reuseCache, refreshScan
    }), true);
  }

  function checkEvidence(): void {
    setCheckingEvidence(true);
    setError(null);
    api.space(id).then(({ space }) => {
      let checked = 0;
      const changed = space.diagrams.flatMap(({ id, title, claims }) => {
        const citations = (claims ?? []).flatMap(({ evidence }) => evidence).filter(({ fingerprint }) => !!fingerprint);
        checked += citations.length;
        const paths = [...new Set(citations.filter(({ stale }) => stale).map(({ path }) => path))];
        return paths.length ? [{ id, title, paths }] : [];
      });
      setEvidenceChanges({ checked, changed });
    }).catch((err: Error) => setError(err.message)).finally(() => setCheckingEvidence(false));
  }

  function download(): void {
    setDialog(null);
    setExporting(true);
    setError(null);
    api.exportBundle(id).then(({ zip }) => { window.location.href = zip; })
      .catch((err: Error) => setError(err.message)).finally(() => setExporting(false));
  }

  function toggleOverlay(overlay: OverlayItem): void {
    if (operationBusy) return;
    setSavingOverlay(true);
    setError(null);
    api.setOverlayHidden(id, overlay, !overlay.hidden).then(({ hidden }) => {
      setOverlays((items) => items.map((item) => item.id === overlay.id && sameSlot(item, overlay) ? { ...item, hidden } : item));
      setNotice(hidden ? "Bundled visuals selected for this display." : "Personal model selected for this display.");
    }).catch((err: Error) => setError(err.message)).finally(() => setSavingOverlay(false));
  }

  return (
    <main className="studio-main">
      <div className="studio-heading">
        <div>
          <a className="studio-eyebrow studio-link" href="#projects">← Workspaces</a>
          <h1>{project?.name ?? "Workspace"}</h1>
        </div>
        {hasSpace && (
          <div className="studio-actions">
            <button className="studio-button" type="button" onClick={() => setDialog("export")} disabled={operationBusy}>
              {exporting ? "Exporting…" : "Export bundle"}
            </button>
            <button className="studio-button studio-primary" type="button" onClick={() => onWalkSpace()}>
              {job?.focusReady ? "Open focus city" : isRunning(job) || job?.status === "failed" || job?.status === "interrupted" || job?.quality?.keptPrevious
                ? "Open saved city" : "Enter city"}
            </button>
          </div>
        )}
      </div>
      {job && (
        <div className="studio-tabs" aria-label="Workspace view">
          <button type="button" aria-pressed={screen === "brief"} onClick={() => setScreen("brief")}>Workspace &amp; brief</button>
          <button type="button" aria-pressed={screen === "job"} onClick={() => setScreen("job")}>{job.kind === "overlay" ? "Personal model job" : "Generation job"}</button>
          {job.kind === "overlay" && !isRunning(job) && <button type="button" onClick={() => {
            api.project(id).then(({ latestGenerationJob }) => {
              if (latestGenerationJob) setJob(latestGenerationJob);
            }).catch((err: Error) => setError(err.message));
          }}>Back to generation job</button>}
        </div>
      )}
      {error && <p role="alert" className="studio-alert">{error}</p>}
      {notice && <p role="status" className="studio-scan studio-notice">{notice}</p>}
      {pollError && activeJobId && <p role="status" className="studio-alert">Reconnecting to the local job…</p>}
      {screen === "job" && job ? <GenerationPanel job={job} busy={operationBusy}
        onPreview={(artifact) => onPreview(job.id, artifact)}
        onRetry={(deliverableId) => start("space", api.retryDeliverable(id, job.id, deliverableId))}
        onContinue={() => start("space", api.continueLessons(id, job.id))} /> : (
        <>
          <div className="studio-panel studio-grid studio-overview studio-scan-overview">
            <div>
              <span className="studio-field-label">Workspace</span>
              <p className="studio-path" title={project?.source_dir}>{project?.source_dir ?? "Loading workspace…"}</p>
              <span className="studio-scan-readonly">Read-only source folder</span>
            </div>
            <div>
              <span className="studio-field-label">Scan status</span>
              <div className={`studio-scan ${rescanning || !report ? "studio-scan-waiting" : report.truncated ? "studio-scan-warning" : ""}`}>
                <span aria-hidden="true">{rescanning || !report ? "◌" : report.truncated ? "!" : "✓"}</span>
                <strong>{rescanning ? "Scanning workspace" : !report ? "Waiting for scan"
                  : report.truncated ? "Scan reached its limits" : "Scan complete"}</strong>
                {report && <small>{report.totals.files.toLocaleString()} files · {report.docs.length} docs</small>}
              </div>
              {report && <ScanDetails report={report} />}
            </div>
          </div>
          <div className="studio-grid studio-brief-grid">
            <section className="studio-panel">
              <div className="studio-section-title">
                <h2>Discovered map</h2>
                <button className="studio-button studio-small" type="button" onClick={rescan}
                  disabled={operationBusy || !project}>Re-scan</button>
              </div>
              <label className="studio-field studio-inventory-filter">Find a module or document
                <input type="search" value={inventoryQuery} onChange={(event) => setInventoryQuery(event.target.value)} placeholder="Search the scan" />
              </label>
              <div className="studio-module-list">
                {inventoryModules.map((module) => {
                  const docs = docsFor(module.name).filter((doc) => matchesInventory(module.name) || matchesInventory(`${doc.path} ${doc.title ?? ""}`));
                  return (
                    <details key={module.name} className="studio-module">
                      <summary title={module.name} data-focused={module.name === focusModule}>
                        <span>{module.name.split("/").at(-1) ?? module.name}</span>
                        <small>{module.files} files</small>
                      </summary>
                      <p className="studio-muted">{module.name}</p>
                      <ul>{docs.map((doc) => <li key={doc.path} title={doc.path}>{doc.title ?? doc.path}</li>)}</ul>
                      <small>{docs.length ? `${docs.length} mapped documents` : "No mapped documents"}</small>
                      <div className="studio-module-actions">
                        <button className="studio-button studio-small" type="button" aria-pressed={module.name === focusModule}
                          onClick={() => setFocusModule(module.name)}>{module.name === focusModule ? "Current focus" : "Set as focus"}</button>
                        <button className="studio-button studio-small" type="button" aria-pressed={lessonModules.includes(module.name)}
                          disabled={!lessonModules.includes(module.name) && (lessonModules.length >= pinnedLessonLimit || module.name === focusModule)}
                          onClick={() => toggleLessonModule(module.name)}>{lessonModules.includes(module.name) ? "Remove lesson" : "Add lesson"}</button>
                      </div>
                    </details>
                  );
                })}
                {unmappedDocs.length > 0 && <details className="studio-module"><summary><span>Cross-cutting documentation</span><small>{unmappedDocs.length} docs</small></summary>
                  <ul>{unmappedDocs.map((doc) => <li key={doc.path} title={doc.path}>{doc.title ?? doc.path}</li>)}</ul>
                </details>}
                {inventoryTerm && !inventoryModules.length && !unmappedDocs.length && <p className="studio-muted">No results in this scan.</p>}
                {!report && <p className="studio-muted">Discovering modules and documentation…</p>}
                {report?.modules.length === 0 && <p className="studio-muted">No modules were discovered.</p>}
              </div>
            </section>
            <form className="studio-panel studio-brief" onSubmit={(event) => {
              event.preventDefault();
              if (!project || !report || operationBusy || !available || !validFocus) return;
              setDialog("review");
            }}>
              <label className="studio-field">
                <strong>Brief</strong>
                <textarea value={brief} maxLength={2000} rows={5} onChange={(event) => updateBrief(event.target.value)}
                  aria-describedby="studio-brief-lesson-help"
                  placeholder="Who is learning, and what should the city explain in depth?" />
              </label>
              <p className="studio-muted studio-lesson-help" id="studio-brief-lesson-help">The brief decides which buildings get a lesson. Pin a module from the discovered map to make sure it is one of them.</p>
              <label className="studio-field">Focus module
                <select value={focusModule} onChange={(event) => setFocusModule(event.target.value)}>
                  <option value="">Resolve from the brief</option>
                  {!validFocus && <option value={focusModule}>{focusModule} · absent from scan</option>}
                  {report?.modules.map(({ name }) => <option key={name} value={name}>{name}</option>)}
                </select>
              </label>
              <div className="studio-generation-fields">
                <label className="studio-field">
                  Content language
                  <select value={language} onChange={(event) => setLanguage(event.target.value)}>
                    {!LANGUAGE_LABELS[language] && <option value={language}>{language}</option>}
                    {Object.entries(LANGUAGE_LABELS).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
                  </select>
                </label>
                <label className="studio-field">
                  Agent
                  <select value={selectedAgent} onChange={(event) => {
                    setAgent(event.target.value as AgentId);
                    setModel("");
                  }}>
                    {(Object.keys(AGENT_LABELS) as AgentId[]).map((agentId) => {
                      const candidate = agents?.find((item) => item.id === agentId);
                      return <option key={agentId} value={agentId} disabled={!candidate?.available || !candidate.implemented}>
                        {AGENT_LABELS[agentId]}{agents && !candidate?.available ? " · unavailable" : ""}
                      </option>;
                    })}
                  </select>
                </label>
                <div className="studio-model-option studio-model-row">
                  <label className="studio-field">
                    Model override
                    <input value={model} maxLength={64} autoCapitalize="off" spellCheck={false}
                      onChange={(event) => setModel(event.target.value)} placeholder="Agent default" />
                  </label>
                  <button type="button" className="studio-button studio-small" onClick={() => setModel("")}
                    disabled={!model}>Use agent default</button>
                </div>
              </div>
              {agents && !available && <p className="studio-muted">Choose an available agent in <a className="studio-link" href="#settings">Settings</a>.</p>}
              <details className="studio-options">
                <summary>Scan and cache options</summary>
                <label className="studio-checkbox"><input type="checkbox" checked={refreshScan}
                  onChange={(event) => setRefreshScan(event.target.checked)} /> Refresh source scan</label>
                <label className="studio-checkbox"><input type="checkbox" checked={reuseCache}
                  onChange={(event) => setReuseCache(event.target.checked)} /> Reuse cached lessons</label>
              </details>
              <div className="studio-actions studio-brief-submit">
                <button className="studio-button studio-primary" type="submit"
                  disabled={!project || !report || operationBusy || !available || !validFocus}>
                  {generating ? "Generating…" : "Generate"}
                </button>
              </div>
            </form>
          </div>
        </>
      )}
      {hasSpace && assetRows.length > 0 && (
        <details className="studio-panel studio-disclosure">
          <summary>Personal models <span>{overlays.length} saved · {offers.length} offers</span></summary>
          <p className="studio-muted">Choose a saved personal model or switch its display back to the bundled visuals. The next city visit and export use your selection.</p>
          {!tripo && <p className="studio-muted">Add a Tripo key in <a href="#settings" className="studio-link">Settings</a> to use an offer.</p>}
          <ul className="studio-overlay-list">
            {assetRows.map(({ offer, index, overlay }) => {
              const slot = (offer ?? overlay)!;
              const canGenerate = offer && index !== undefined && offer.prompt !== overlay?.prompt;
              return (
                <li key={`${slot.building}:${slot.class}:${index ?? "saved"}`} className="studio-overlay-row">
                  <div>
                    <strong>{focusTitle(slot.building)}</strong> <span className="studio-muted">· {slot.class}</span>
                    {overlay && <span className={`studio-overlay-state studio-status studio-status-${overlay.hidden ? "queued" : "ready"}`}>
                      {overlay.hidden ? "Bundled visuals" : "Personal model"}
                    </span>}
                    <details className="studio-overlay-prompt">
                      <summary>{canGenerate && overlay ? "Show new offer" : "Show prompt"}</summary>
                      <p>{slot.prompt}</p>
                    </details>
                  </div>
                  <div className="studio-overlay-actions">
                    {overlay && <button type="button" className="studio-button studio-small" disabled={operationBusy}
                      onClick={() => toggleOverlay(overlay)}>{overlay.hidden ? "Show personal model" : "Use bundled visuals"}</button>}
                    {canGenerate && <button type="button" className="studio-button studio-small" disabled={!tripo || operationBusy}
                      onClick={() => start("overlay", api.generateOffer(id, index))}>{overlay ? "Generate new offer" : "Generate overlay"}</button>}
                  </div>
                </li>
              );
            })}
          </ul>
        </details>
      )}
      {hasSpace && <SavedCities id={id} busy={operationBusy} revision={`${job?.id ?? ""}:${job?.status ?? ""}:${job?.focusReady ? 1 : 0}`}
        onError={setError} onOpened={(city) => {
          try { localStorage.removeItem(draftKey(id)); } catch { /* the opened city's brief is stored on the server */ }
          setBrief(city.brief);
          setLanguage(city.language);
          setEvidenceChanges(null);
          loadOffers();
          onWalkSpace();
        }} />}
      {hasSpace && (
        <details className="studio-panel studio-disclosure">
          <summary>Evidence changes</summary>
          <p className="studio-muted">Check whether the code and document lines behind saved explanations still match.</p>
          <button type="button" className="studio-button studio-small" onClick={checkEvidence}
            disabled={operationBusy || checkingEvidence}>{checkingEvidence ? "Checking…" : "Check saved explanations"}</button>
          {evidenceChanges && <div role="status" className="studio-evidence-changes">
            <p className="studio-muted">{evidenceChanges.checked === 0 ? "This city has no saved explanation fingerprints."
              : `${evidenceChanges.checked} citations checked · ${evidenceChanges.changed.length} diagrams with changed evidence.`}</p>
            {!!evidenceChanges.changed.length && <ul className="studio-evidence">
              {evidenceChanges.changed.map(({ id, title, paths }) => <li key={id}>
                <strong>{title}</strong>
                <span>{paths.join(", ")}</span>
                <button className="studio-button studio-small" type="button" onClick={() => onWalkSpace(id)}>Open diagram ↗</button>
              </li>)}
            </ul>}
          </div>}
        </details>
      )}
      {project && (
        <details className="studio-panel studio-disclosure">
          <summary>Workspace actions</summary>
          <div className="studio-workspace-actions">
            <button className="studio-button" type="button" onClick={rescan} disabled={operationBusy}>Re-scan</button>
            <button className="studio-button" type="button" onClick={() => setDialog("cache")} disabled={operationBusy}>Clear generation cache</button>
            <button className="studio-button studio-danger" type="button" onClick={() => setDialog("remove")}
              disabled={operationBusy}>Remove workspace</button>
          </div>
          <p className="studio-muted">Workspace actions keep your source files.</p>
        </details>
      )}
      {dialog === "review" && (
        <StudioDialog title="Review generation options" onClose={() => setDialog(null)}>
          <dl className="studio-review">
            <dt>Workspace</dt><dd>{project?.name}</dd>
            <dt>Focus module</dt><dd>{focusModule || (focusHints.length === 1 ? `${focusHints[0]} · candidate` : "Resolved during generation")}</dd>
            {!!lessonModules.length && <><dt>Pinned lessons</dt><dd>{lessonModules.join(", ")}</dd></>}
            <dt>Language</dt><dd>{LANGUAGE_LABELS[language] ?? language}</dd>
            <dt>Agent</dt><dd>{AGENT_LABELS[selectedAgent]}</dd>
            <dt>Model</dt><dd>{model.trim() || "Agent default"}</dd>
            <dt>Source scan</dt><dd>{refreshScan ? "Refresh source scan" : "Reuse current scan"}</dd>
            <dt>Lesson cache</dt><dd>{reuseCache ? "Reuse validated lessons" : "Generate fresh lessons"}</dd>
          </dl>
          {brief.trim() && <p className="studio-review-brief">{brief.trim()}</p>}
          <div className="studio-actions">
            <button type="button" className="studio-button" onClick={() => setDialog(null)}>Back to brief</button>
            <button type="button" className="studio-button studio-primary" onClick={generate}>Generate</button>
          </div>
        </StudioDialog>
      )}
      {dialog === "export" && (
        <StudioDialog title="Export offline city" onClose={() => setDialog(null)}>
          <p>The ZIP includes the walkable city, diagrams, scenarios, lessons and the models used by this city. Review the generated text, source references and model rights before sharing.</p>
          <div className="studio-actions">
            <button type="button" className="studio-button" onClick={() => setDialog(null)}>Cancel</button>
            <button type="button" className="studio-button studio-primary" onClick={download}>Export ZIP</button>
          </div>
        </StudioDialog>
      )}
      {(dialog === "cache" || dialog === "remove") && (
        <StudioDialog title={dialog === "remove" ? "Remove workspace?" : "Clear generation cache?"}
          busy={maintaining} onClose={() => setDialog(null)}>
          <p>{dialog === "remove"
            ? `Remove ${project?.name ?? "this workspace"} and its local city, job history and exports. Your source files and shared model receipts are kept.`
            : "Clear the workspace scan and cached lessons. Your saved city, brief, exports and source files are kept."}</p>
          <div className="studio-actions">
            <button type="button" className="studio-button" onClick={() => setDialog(null)} disabled={maintaining}>Cancel</button>
            <button type="button" className={`studio-button ${dialog === "remove" ? "studio-danger-fill" : "studio-primary"}`}
              onClick={() => maintain(dialog)} disabled={maintaining}>
              {maintaining ? "Working…" : dialog === "remove" ? "Remove workspace" : "Clear cache"}
            </button>
          </div>
        </StudioDialog>
      )}
    </main>
  );
}
