import { useState, useRef } from "react";

export function splitPhone(value: string) {
  const compact = value.replace(/[\s().-]/g, "").replace(/^00/, "+");
  const prefix = compact.startsWith("+44") ? "44" : "353";
  const number = compact.replace(/^\+(353|44)/, "").replace(/^0+/, "");
  return { prefix, number };
}

function Flag({ uk }: { uk: boolean }) {
  return uk ? <svg aria-hidden="true" viewBox="0 0 60 30" className="phone-flag">
    <rect width="60" height="30" fill="#012169" />
    <path d="M0 0L60 30M60 0L0 30" stroke="white" strokeWidth="6" />
    <path d="M0 0L60 30M60 0L0 30" stroke="#c8102e" strokeWidth="2" />
    <path d="M30 0V30M0 15H60" stroke="white" strokeWidth="10" />
    <path d="M30 0V30M0 15H60" stroke="#c8102e" strokeWidth="6" />
  </svg> : <svg aria-hidden="true" viewBox="0 0 60 30" className="phone-flag">
    <rect width="60" height="30" fill="white" /><rect width="20" height="30" fill="#169b62" />
    <rect x="40" width="20" height="30" fill="#ff883e" />
  </svg>;
}

export default function PhoneInput({ value, onChange, required = false, id }: {
  value: string; onChange: (value: string) => void; required?: boolean; id?: string;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  const parsed = splitPhone(value);
  const [country, setCountry] = useState(parsed.prefix);
  const prefix = value.startsWith("+") ? parsed.prefix : country;
  function change(number: string, selected = prefix) {
    const pasted = number.trim().replace(/^00/, "+");
    const detected = pasted.startsWith("+44") ? "44" : pasted.startsWith("+353") ? "353" : selected;
    setCountry(detected);
    const digits = pasted.replace(/^\+(353|44)/, "").replace(/\D/g, "").replace(/^0+/, "");
    onChange(digits ? `+${detected} ${digits}` : "");
  }
  return <span className="phone-input">
    <details className="phone-country" ref={menu}
      onKeyDown={e => { if(e.key === "Escape") { menu.current!.open = false; menu.current!.querySelector("summary")?.focus(); } }}
      onBlur={e => { if(!e.currentTarget.contains(e.relatedTarget as Node)) menu.current!.open = false; }}>
      <summary aria-label="Phone country code">
        <Flag uk={prefix === "44"} /><span>{prefix === "44" ? "UK (+44)" : "Ireland (+353)"}</span><span aria-hidden="true">⌄</span>
      </summary>
      <span className="phone-country-options">
        {[{code:"353",name:"Ireland (+353)"},{code:"44",name:"UK (+44)"}].map(c =>
          <button type="button" key={c.code} aria-pressed={prefix === c.code} onClick={() => {
            setCountry(c.code); change(parsed.number,c.code); menu.current!.open = false;
            menu.current!.querySelector("summary")?.focus();
          }}><Flag uk={c.code === "44"} />{c.name}</button>)}
      </span>
    </details>
    <input id={id} type="tel" inputMode="tel" autoComplete="tel-national" aria-label="Phone number"
      required={required} pattern="[0-9]{7,12}" title="Enter a phone number containing 7 to 12 digits. The leading zero is removed automatically."
      placeholder="Phone number" value={parsed.number} onChange={e => change(e.target.value)} onBlur={() => change(parsed.number)} />
  </span>;
}
