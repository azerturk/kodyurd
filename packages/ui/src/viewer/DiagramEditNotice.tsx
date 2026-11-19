import type { DiagramEditStatus } from "../space-types";

export function DiagramEditNotice({ status, editable = false }: { status?: DiagramEditStatus; editable?: boolean }) {
  if (!status) return null;
  const message = status.state === "changed"
    ? "The generated diagram changed after this correction was saved. Your correction is kept."
    : status.state === "missing"
      ? "The original generated diagram is no longer in this city. Your correction is kept."
      : status.state === "unknown"
        ? "The original generated version was not recorded for this older correction. Your correction is kept."
        : undefined;
  if (!message) return null;
  return <p className="kd-tour-note" role="note">{message}{editable && status.state !== "unknown" && (status.state === "missing"
    ? " Removing this correction will remove the diagram."
    : " Restore replaces it with the current generated diagram.")}</p>;
}
