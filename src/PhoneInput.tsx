import { useState } from "react";

export function splitPhone(value: string) {
  const compact = value.replace(/[\s().-]/g, "").replace(/^00/, "+");
  const prefix = compact.startsWith("+44") ? "44" : "353";
  const number = compact.replace(/^\+(353|44)/, "").replace(/^0+/, "");
  return { prefix, number };
}

export default function PhoneInput({ value, onChange, required = false }: {
  value: string; onChange: (value: string) => void; required?: boolean;
}) {
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
    <select aria-label="Phone country code" value={prefix} onChange={e => {
      setCountry(e.target.value); change(parsed.number, e.target.value);
    }}>
      <option value="353">🇮🇪 Ireland (+353)</option>
      <option value="44">🇬🇧 UK (+44)</option>
    </select>
    <input type="tel" inputMode="tel" autoComplete="tel-national" aria-label="Phone number"
      required={required} pattern="[0-9]{7,12}" title="Enter a phone number containing 7 to 12 digits. The leading zero is removed automatically."
      placeholder="Phone number" value={parsed.number} onChange={e => change(e.target.value)} onBlur={() => change(parsed.number)} />
  </span>;
}
