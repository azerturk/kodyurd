import { useEffect, useId, useRef, type ReactNode } from "react";

export default function StudioDialog({ title, children, onClose, busy = false }: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    dialog?.querySelector<HTMLElement>("[data-initial-focus]")?.focus();
    return () => dialog?.close();
  }, []);
  return (
    <dialog className="studio-dialog" ref={ref} aria-labelledby={titleId} onCancel={(event) => {
      event.preventDefault();
      if (!busy) onClose();
    }}>
      <div className="studio-section-title studio-dialog-heading">
        <h2 id={titleId}>{title}</h2>
        <button className="studio-button studio-small" type="button" onClick={onClose}
          disabled={busy} aria-label="Close dialog">×</button>
      </div>
      {children}
    </dialog>
  );
}
