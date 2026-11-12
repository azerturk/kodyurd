import { useEffect, useState } from "react";
import { api, type SavedCity } from "../api";

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? "" : "s"}`;

/** The cities this workspace has generated, one per brief, with the one that is open now. */
export default function SavedCities({ id, revision, busy, onOpened, onError }: {
  id: string;
  /** Changes when a generation may have added or replaced a city. */
  revision: string;
  busy: boolean;
  onOpened: (city: SavedCity) => void;
  onError: (message: string) => void;
}) {
  const [saved, setSaved] = useState<{ current?: string; cities: SavedCity[] } | null>(null);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    let current = true;
    api.savedCities(id).then((data) => { if (current) setSaved(data); }).catch(() => undefined);
    return () => { current = false; };
  }, [id, revision]);

  if (!saved?.cities.length) return null;

  const run = (action: Promise<unknown>, done: () => void): void => {
    setWorking(true);
    action.then(done).catch((err: Error) => onError(err.message)).finally(() => setWorking(false));
  };

  return (
    <details className="studio-panel studio-disclosure">
      <summary>Saved cities <span>{plural(saved.cities.length, "brief")}</span></summary>
      <p className="studio-muted">Each brief keeps its latest city. Open one to return to it without generating again.</p>
      <ul className="studio-overlay-list">
        {saved.cities.map((city) => {
          const open = city.jobId === saved.current;
          return (
            <li key={city.jobId} className="studio-overlay-row">
              <div>
                <strong>{city.title}</strong>
                {open && <span className="studio-overlay-state studio-status studio-status-ready">Open now</span>}
                <p className="studio-saved-brief">{city.brief.trim() || "No brief"}</p>
                <span className="studio-muted">
                  {new Date(city.savedAt).toLocaleDateString()} · {plural(city.buildings, "building")} · {plural(city.lessons, "interior")} · {plural(city.diagrams, "diagram")} · {plural(city.flows, "replay")}
                </span>
              </div>
              <div className="studio-overlay-actions">
                {!open && <button type="button" className="studio-button studio-small" disabled={busy || working}
                  onClick={() => run(api.openSavedCity(id, city.jobId), () => {
                    setSaved({ ...saved, current: city.jobId });
                    onOpened(city);
                  })}>Open</button>}
                {!open && <button type="button" className="studio-button studio-small" disabled={busy || working}
                  onClick={() => run(api.removeSavedCity(id, city.jobId), () =>
                    setSaved({ ...saved, cities: saved.cities.filter(({ jobId }) => jobId !== city.jobId) }))}>Remove</button>}
              </div>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
