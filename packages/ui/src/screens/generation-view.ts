import type { GenerationDeliverable, JobView } from "../api";

export const isRunning = (job: Pick<JobView, "status"> | null): boolean =>
  job?.status === "queued" || job?.status === "running" || job?.status === "stopping";

export const isJobActive = (job: JobView | null): boolean => isRunning(job) || job?.status === "awaiting-review";

export function jobStatus(job: JobView): string {
  if (job.status === "awaiting-review") return "Review the plan";
  if (job.status === "stopping") return "Stopping";
  if (job.status === "stopped") return "Stopped";
  if (job.status === "interrupted") return "Interrupted";
  if (job.status === "failed") return "Failed";
  if (isRunning(job)) return job.focusReady ? "Focus ready · building lessons" : "Running";
  if (job.quality?.status === "partial") return "Partial";
  if (job.quality?.status === "pending") return "Focus pending";
  return job.status === "done" ? "Complete" : job.status;
}

export function elapsedJob(job: Pick<JobView, "createdAt" | "updatedAt" | "status">, now: number): string | undefined {
  const start = Date.parse(job.createdAt);
  const end = isRunning(job) ? now : Date.parse(job.updatedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return undefined;
  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

export interface DeliverableGroup {
  id: string;
  title: string;
  items: GenerationDeliverable[];
}

/** New jobs carry ownership; old jobs can recover it from their evidence stages. */
export function deliverableGroups(job: JobView): DeliverableGroup[] {
  const groups = new Map<string, DeliverableGroup>();
  const recent = [...job.stages].reverse();
  for (const item of job.deliverables ?? []) {
    const stage = recent.find((entry) => entry.deliverableId === item.id && entry.building);
    const titlePrefix = item.title.includes(" · ") ? item.title.split(" · ")[0] : undefined;
    const building = item.building ?? stage?.building ?? (item.id.startsWith("focus-") ? job.quality?.focusBuilding ?? "focus" : undefined);
    const id = building ?? titlePrefix ?? "workspace";
    const title = item.buildingTitle ?? titlePrefix ?? (building ? readableBuilding(building) : "Workspace");
    const group = groups.get(id) ?? { id, title, items: [] };
    group.items.push(item);
    groups.set(id, group);
  }
  return [...groups.values()];
}

function readableBuilding(id: string): string {
  if (id === "focus") return "Focus lesson";
  if (!/^b-[a-z0-9]+(?:[-_.][a-z0-9]+)*$/.test(id)) return id;
  return id.slice(2).split(/[-_.]/).map((word) => word[0].toUpperCase() + word.slice(1)).join(" ");
}
