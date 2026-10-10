import { useEffect, useRef } from "react";
type Item = { id: number; name: string; duration: number; price: number };
export default function VisitSelection({ items, prompt, onAdd, onProceed, onRemove }: {
  items: Item[]; prompt: boolean; onAdd: () => void; onProceed: () => void; onRemove: (index: number) => void;
}) {
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!prompt) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden"; button.current?.focus();
    return () => { document.body.style.overflow = overflow; previous?.focus(); };
  }, [prompt, items.length]);
  if (!items.length) return null;
  const money = (n: number) => new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" }).format(n);
  const summary = <><h2>Your treatments</h2><ol>{items.map((t, i) => <li key={i}>{t.name} · {t.duration} minutes · {money(Number(t.price))} <button className="back" type="button" aria-label={`Remove ${t.name}`} onClick={() => onRemove(i)}>Remove</button></li>)}</ol>
    <p><strong>Total: {items.reduce((n,t) => n+t.duration,0)} minutes · {money(items.reduce((n,t) => n+Number(t.price),0))}</strong></p>
    <p className="small">Treatments run in the order selected, with one staff member. Each treatment can be amended or cancelled individually afterwards.</p></>;
  return <>
    <section className="panel visit-selection">{summary}<button type="button" className="primary" onClick={onProceed}>Choose a Date/Time</button></section>
    {prompt && <div className="modal-backdrop"><section className="panel modal" role="dialog" aria-modal="true" aria-label="Add another treatment" onKeyDown={e => { if(e.key === "Escape") onAdd(); if(e.key === "Tab") { const bs=e.currentTarget.querySelectorAll('button'); const first=bs[0],last=bs[bs.length-1]; if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();} } }}>
      <h2>{items[items.length - 1].name} selected.</h2>
      <p>Do you want to choose an available time for {items.length === 1 ? "that treatment" : "those treatments"} or add more treatments?</p>
      <p>{items.length} treatment{items.length===1?'':'s'} selected - total time: {items.reduce((n,t)=>n+t.duration,0)} minutes</p>
      <div className="record-actions"><button ref={button} type="button" className="secondary" disabled={items.length>=12} onClick={onAdd}>Add Another Treatment</button><button type="button" className="primary" onClick={onProceed}>Choose a Date/Time</button><button type="button" className="secondary" onClick={() => onRemove(items.length - 1)}>Cancel</button></div>
    </section></div>}
  </>;
}
