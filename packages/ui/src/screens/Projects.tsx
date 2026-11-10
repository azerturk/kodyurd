import { useEffect, useRef, useState } from "react";
import { api, type CityPreview, type Project } from "../api";
import StudioDialog from "./StudioDialog";
import WorkspaceMap from "./WorkspaceMap";

function WorkspaceFolder() {
  return (
    <svg className="workspace-folder-art" viewBox="0 0 110 90" aria-hidden="true" focusable="false">
      <path d="M13 31h75v40H13Z" fill="#c7d8c7" opacity=".38" transform="translate(5 7)" />
      <path d="M13 28a5 5 0 0 1 5-5h21l8 8h36a5 5 0 0 1 5 5v33a5 5 0 0 1-5 5H18a5 5 0 0 1-5-5Z"
        fill="#a9ccbb" stroke="#347a69" strokeWidth="1.8" />
      <path d="M18 43h65a5 5 0 0 1 5 5v21a5 5 0 0 1-5 5H18a5 5 0 0 1-5-5V48a5 5 0 0 1 5-5Z"
        fill="#e0eee0" stroke="#347a69" strokeWidth="1.8" />
      <path d="M37 60h27m-21 5h15M74 22l2-8m6 11 6-6m-3 13 8-2" fill="none"
        stroke="#347a69" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

function WorkspaceCard({ project, open, openCity }: { project: Project; open: () => void; openCity: () => void }) {
  const frame = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState<CityPreview | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);

  useEffect(() => {
    if (!project.hasSpace) return;
    let active = true;
    let requested = false;
    let observer: IntersectionObserver | undefined;
    function load(): void {
      if (!active || requested) return;
      requested = true;
      observer?.disconnect();
      api.cityPreview(project.id).then((data) => {
        if (!active) return;
        if (!data.city?.bounds || !data.city.plaza?.pos || !Array.isArray(data.city.buildings)) {
          setPreviewFailed(true);
          return;
        }
        setPreview(data);
      }).catch(() => { if (active) setPreviewFailed(true); });
    }
    if (typeof IntersectionObserver === "undefined" || !frame.current) load();
    else {
      observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) load();
      }, { rootMargin: "120px" });
      observer.observe(frame.current);
    }
    return () => {
      active = false;
      observer?.disconnect();
    };
  }, [project.hasSpace, project.id]);

  const savedAt = preview ? new Date(preview.savedAt) : undefined;
  const savedDate = savedAt && Number.isFinite(savedAt.getTime()) ? savedAt.toLocaleDateString(undefined, { dateStyle: "medium" }) : undefined;
  return (
    <article className="studio-panel studio-workspace-card workspace-gallery-card">
      <div className="studio-section-title">
        <h2>{project.name}</h2>
        <span className={`studio-status studio-status-${project.hasSpace ? "ready" : "queued"}`}>
          {project.hasSpace ? "Saved city" : "Workspace"}
        </span>
      </div>
      <div ref={frame} className="workspace-gallery-preview">
        {preview ? <WorkspaceMap city={preview.city} focusId={preview.focusId} /> : <WorkspaceFolder />}
        <span className="workspace-gallery-caption">
          {preview ? (preview.city.buildings.length > 12 ? "Area map preview" : "City map preview")
            : project.hasSpace ? (previewFailed ? "Map preview unavailable" : "Loading map preview…") : "Ready for a brief"}
        </span>
      </div>
      <div className="workspace-gallery-details">
        {preview?.focusTitle && <div className="workspace-gallery-focus">
          <span>Starts at</span> <strong>{preview.focusTitle}</strong>
        </div>}
        <p className="workspace-gallery-path" title={project.source_dir}>{project.source_dir}</p>
        {preview && <p className="workspace-gallery-meta">
          <span>{preview.city.buildings.length} {preview.city.buildings.length === 1 ? "building" : "buildings"}</span>
          {savedDate && <span>Saved <time dateTime={preview.savedAt}>{savedDate}</time></span>}
        </p>}
      </div>
      <div className="studio-actions workspace-gallery-actions">
        <button className={`studio-button${project.hasSpace ? "" : " studio-primary"}`} type="button" onClick={open}>Open workspace</button>
        {project.hasSpace && <button className="studio-button studio-primary" type="button" onClick={openCity}>Open city</button>}
      </div>
    </article>
  );
}

export default function Projects({ onOpen, onOpenCity, notice }: {
  onOpen: (id: string) => void;
  onOpenCity: (id: string) => void;
  notice?: string;
}) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [sourceDir, setSourceDir] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [folderStatus, setFolderStatus] = useState<{ found: boolean; text: string } | null>(null);
  const [checkingFolder, setCheckingFolder] = useState(false);
  const folderRequest = useRef(0);

  useEffect(() => {
    let current = true;
    api.projects().then(({ projects }) => {
      if (!current) return;
      setProjects(projects);
    }).catch((err: Error) => { if (current) setError(err.message); });
    return () => { current = false; };
  }, []);

  function checkFolder(): void {
    if (!sourceDir.trim()) return;
    const request = ++folderRequest.current;
    setCheckingFolder(true);
    api.validateWorkspace(sourceDir.trim()).then(() => {
      if (request === folderRequest.current) setFolderStatus({ found: true, text: "Folder found" });
    }).catch((err: Error) => {
      if (request === folderRequest.current) setFolderStatus({ found: false, text: err.message });
    }).finally(() => {
      if (request === folderRequest.current) setCheckingFolder(false);
    });
  }

  function closeForm(): void {
    folderRequest.current++;
    setShowForm(false);
    setFolderStatus(null);
    setCheckingFolder(false);
    setError(null);
  }

  function create(): void {
    setBusy(true);
    setError(null);
    api.createProject({ name: name.trim(), sourceDir: sourceDir.trim() })
      .then(({ project }) => onOpen(project.id))
      .catch((err: Error) => setError(err.message))
      .finally(() => setBusy(false));
  }

  return (
    <main className="studio-main">
      <div className="studio-heading">
        <div>
          <p className="studio-eyebrow">Knowledge city</p>
          <h1>Workspaces</h1>
          <p>Explore a saved city or add a local codebase to map its architecture and workflows.</p>
        </div>
        {!!projects?.length && <button className="studio-button studio-primary" type="button"
          onClick={() => setShowForm(true)}>＋ Add workspace</button>}
      </div>
      {notice && <p role="status" className="studio-scan">{notice}</p>}
      {error && !showForm && <p role="alert" className="studio-alert">{error}</p>}
      {projects?.length === 0 && (
        <section className="studio-panel studio-empty workspace-gallery-empty">
          <div className="workspace-gallery-icon"><WorkspaceFolder /></div>
          <h2>Add a workspace</h2>
          <p className="studio-muted">Open a local source folder and choose what the city should explain.</p>
          <div className="studio-actions">
            <button className="studio-button studio-primary" type="button" onClick={() => setShowForm(true)}>Add workspace</button>
            <a className="studio-button" href="#settings">Agent settings</a>
          </div>
        </section>
      )}
      {showForm && (
        <StudioDialog title="Add a workspace" busy={busy} onClose={closeForm}>
          <form className="studio-new-workspace" onSubmit={(event) => {
            event.preventDefault();
            create();
          }}>
            {error && <p role="alert" className="studio-alert">{error}</p>}
            <label className="studio-field">
              Workspace name
              <input data-initial-focus required maxLength={120} value={name} placeholder="e.g. Queue Worker"
                onChange={(event) => setName(event.target.value)} />
            </label>
            <div className="studio-folder-check">
              <label className="studio-field">
                Folder path
                <input required maxLength={4096} value={sourceDir} placeholder="Paste the local folder path"
                  aria-describedby="workspace-folder-help" aria-invalid={folderStatus?.found === false || undefined}
                  onBlur={(event) => { if (event.relatedTarget?.getAttribute("data-check-folder") !== "true") checkFolder(); }}
                  onChange={(event) => {
                    folderRequest.current++;
                    setFolderStatus(null);
                    setCheckingFolder(false);
                    setSourceDir(event.target.value);
                  }} />
              </label>
              <button className="studio-button studio-small" type="button" data-check-folder="true" onClick={checkFolder}
                disabled={busy || !sourceDir.trim() || checkingFolder}>{checkingFolder ? "Checking…" : "Check folder"}</button>
            </div>
            <p className="workspace-gallery-path-help" id="workspace-folder-help">Kodyurd scans the source folder read-only.</p>
            {folderStatus && folderStatus.text !== error && <p role="status" className={folderStatus.found ? "studio-ok" : "studio-muted"}>
              {folderStatus.found ? "✓ " : ""}{folderStatus.text}
            </p>}
            <div className="studio-actions">
              <button type="button" className="studio-button" onClick={closeForm} disabled={busy}>Cancel</button>
              <button className="studio-button studio-primary" type="submit"
                disabled={busy || !name.trim() || !sourceDir.trim()}>
                {busy ? "Adding…" : "Add workspace"}
              </button>
            </div>
          </form>
        </StudioDialog>
      )}
      {projects === null && !error && <p className="studio-muted">Loading workspaces…</p>}
      {(projects?.length ?? 0) > 0 && (
        <ul className="studio-workspaces" aria-label="Saved workspaces">
          {projects?.map((project) => (
            <li key={project.id}>
              <WorkspaceCard project={project} open={() => onOpen(project.id)} openCity={() => onOpenCity(project.id)} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
