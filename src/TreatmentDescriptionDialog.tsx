import { useEffect, useRef } from "react";

export default function TreatmentDescriptionDialog({ name, description, onClose }: {
  name: string; description: string; onClose: () => void;
}) {
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => { document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  return <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    <section ref={dialog} className="panel modal treatment-description-dialog" role="dialog" aria-modal="true" aria-labelledby="treatment-description-title"
      onKeyDown={e => {
        if (e.key === "Escape") onClose();
        if (e.key === "Tab") {
          const buttons = dialog.current?.querySelectorAll("button");
          if (!buttons?.length) return;
          const first = buttons[0], last = buttons[buttons.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      }}>
      <button className="close" type="button" aria-label="Close treatment information" onClick={onClose}>×</button>
      <h2 id="treatment-description-title">{name}</h2>
      <p className="treatment-description-content">{description}</p>
      <button className="primary" type="button" onClick={onClose}>Close</button>
    </section>
  </div>;
}
