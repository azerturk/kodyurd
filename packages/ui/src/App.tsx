import { lazy, Suspense, useCallback, useEffect, useState, type CSSProperties } from "react";
import { api, type AgentId, type GenerationSettings } from "./api";
import Connect from "./screens/Connect";
import Projects from "./screens/Projects";
import ProjectDetail from "./screens/ProjectDetail";
const SpaceViewer = lazy(() => import("./viewer/SpaceViewer"));

type View =
  | { name: "settings" | "projects" }
  | { name: "project"; id: string }
  | { name: "city"; id: string; artifact?: string }
  | { name: "draft"; id: string; jobId: string; artifact?: string };

function readArtifact(query: string | undefined): string | undefined {
  const artifact = new URLSearchParams(query).get("artifact");
  return artifact && /^[a-zA-Z0-9_.:-]{1,130}$/.test(artifact) ? artifact : undefined;
}

function readView(): View {
  const hash = window.location.hash;
  if (hash === "#settings") return { name: "settings" };
  const draft = /^#draft\/([a-zA-Z0-9-]{1,80})\/([a-zA-Z0-9-]{1,80})(?:\?([^#]{1,420}))?$/.exec(hash);
  if (draft) return { name: "draft", id: draft[1], jobId: draft[2], artifact: readArtifact(draft[3]) };
  const city = /^#city\/([a-zA-Z0-9-]{1,80})(?:\?([^#]{1,420}))?$/.exec(hash);
  if (city) return { name: "city", id: city[1], artifact: readArtifact(city[2]) };
  const project = /^#project\/([a-zA-Z0-9-]{1,80})$/.exec(hash);
  if (project) return { name: "project", id: project[1] };
  return { name: "projects" };
}

function savedTextScale(): number {
  try {
    const scale = localStorage.getItem("kodyurd:text-scale");
    return scale === "1.15" || scale === "1.3" ? Number(scale) : 1;
  } catch { return 1; }
}

function preferredAgent(): AgentId | undefined {
  try {
    const agent = localStorage.getItem("kodyurd:agent");
    return agent === "claude" || agent === "codex" || agent === "api" ? agent : undefined;
  } catch {
    return undefined;
  }
}

function StudioIcon({ name }: { name: "project" | "city" | "settings" }) {
  const shapes = {
    project: "M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
    city: "M3 21h18M5 21V5h8v16m0-10h6v10M8 9h2m-2 4h2m-2 4h2m6-2h1m-1 3h1",
    settings: "M4 7h16M4 12h16M4 17h16M9 5v4m6 1v4m-4 1v4"
  };
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={shapes[name]} />
    </svg>
  );
}

export default function App() {
  const [view, setView] = useState<View>(readView);
  const [workspace, setWorkspace] = useState<{ id: string; hasSpace: boolean } | null>(null);
  const [preferred, setPreferred] = useState<AgentId | undefined>(preferredAgent);
  const [agentOverride, setAgentOverride] = useState<{ id: string; agent: AgentId } | null>(null);
  const [guide, setGuide] = useState<{ id: string; generation: GenerationSettings | null } | null>(null);
  const [textScale, setTextScale] = useState(savedTextScale);
  const [workspaceNotice, setWorkspaceNotice] = useState<string | undefined>();

  useEffect(() => {
    const sync = (): void => setView(readView());
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  const cityId = view.name === "city" || view.name === "draft" ? view.id : undefined;
  const projectId = view.name === "project" ? view.id : undefined;
  const setWorkspaceAvailability = useCallback((hasSpace: boolean): void => {
    if (projectId) setWorkspace({ id: projectId, hasSpace });
  }, [projectId]);
  useEffect(() => {
    if (!cityId) return;
    let current = true;
    api.project(cityId).then((data) => {
      if (!current) return;
      setGuide({ id: cityId, generation: data.generation });
      setWorkspace({ id: cityId, hasSpace: data.hasSpace });
    }).catch(() => undefined);
    return () => { current = false; };
  }, [cityId]);

  function navigate(next: View): void {
    const path = next.name === "draft" ? `draft/${next.id}/${next.jobId}` : "id" in next ? `${next.name}/${next.id}` : next.name;
    const artifact = "artifact" in next ? next.artifact : undefined;
    window.location.hash = artifact ? `${path}?artifact=${encodeURIComponent(artifact)}` : path;
  }

  if (view.name === "city" || view.name === "draft") {
    const settings = guide?.id === view.id ? guide.generation : null;
    return (
      <Suspense fallback={<div className="studio-opening-city" role="status"><span>Opening the city…</span></div>}>
        <SpaceViewer key={`${view.name === "draft" ? view.jobId : view.id}:${view.artifact ?? "city"}`}
          id={view.id} draftJobId={view.name === "draft" ? view.jobId : undefined}
          initialArtifact={view.artifact}
          onExit={() => navigate({ name: "project", id: view.id })}
          guideAgent={settings?.agent ?? preferred} guideModel={settings?.model ?? undefined} />
      </Suspense>
    );
  }

  const projectActive = view.name === "project" || view.name === "projects";
  const workspaceId = view.name === "project" ? view.id : workspace?.id;
  return (
    <div className="kd-studio" style={{ "--studio-scale": textScale } as CSSProperties}>
      <aside className="studio-rail">
        <a className="studio-brand" href="#projects" aria-label="Kodyurd workspaces">Kodyurd</a>
        <nav className="studio-nav" aria-label="Studio">
          <a href="#projects" aria-current={projectActive ? "page" : undefined}>
            <StudioIcon name="project" /> Workspaces
          </a>
          {workspace?.hasSpace ? (
            <a href={`#city/${workspace.id}`}><StudioIcon name="city" /> City</a>
          ) : (
            <span aria-disabled="true"><StudioIcon name="city" /> City</span>
          )}
          <a href="#settings" aria-current={view.name === "settings" ? "page" : undefined}>
            <StudioIcon name="settings" /> Settings
          </a>
        </nav>
        <div className="studio-local"><span /> Local workspace</div>
      </aside>
      {view.name === "settings" && (
        <Connect preferredAgent={preferred} hasWorkspace={!!workspaceId} onScaleChange={setTextScale} onContinue={(agent) => {
          if (agent) {
            setPreferred(agent);
            if (workspaceId) setAgentOverride({ id: workspaceId, agent });
            try { localStorage.setItem("kodyurd:agent", agent); } catch { /* session preference */ }
          }
          navigate(workspaceId ? { name: "project", id: workspaceId } : { name: "projects" });
        }} />
      )}
      {view.name === "projects" && <Projects notice={workspaceNotice}
        onOpen={(id) => { setWorkspaceNotice(undefined); navigate({ name: "project", id }); }}
        onOpenCity={(id) => navigate({ name: "city", id })} />}
      {view.name === "project" && (
        <ProjectDetail key={view.id} id={view.id} preferredAgent={preferred}
          agentOverride={agentOverride?.id === view.id ? agentOverride.agent : undefined}
          onWorkspace={setWorkspaceAvailability}
          onWalkSpace={(artifact) => navigate({ name: "city", id: view.id, artifact })}
          onPreview={(jobId, artifact) => navigate({ name: "draft", id: view.id, jobId, artifact })}
          onRemoved={(cleanupPending) => {
            setWorkspace((current) => current?.id === view.id ? null : current);
            setWorkspaceNotice(cleanupPending ? "Workspace removed. Restart Kodyurd to finish local cleanup." : "Workspace removed. Source files kept.");
            navigate({ name: "projects" });
          }} />
      )}
    </div>
  );
}
