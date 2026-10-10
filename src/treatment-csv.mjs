export const treatmentHeaders = ["Treatment ID", "Category", "Treatment Name", "Treatment Description", "Length in minutes", "Price", "Rebook Window", "Booking guarantee required?", "Patch test Required?"];
export const rebookWindows = ["1 week", "2 weeks", "4 weeks", "2 months", "3 months", "6 months", "12 months"];

// Handles quoted commas, escaped quotes, multiline descriptions, BOM and Excel CRLF.
export function readCsv(text) {
  text = text.replace(/^\uFEFF/, "");
  const rows = []; let row = [], cell = "", quoted = false, closed = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; closed = true; } }
      else cell += c;
    } else if (c === ',') { row.push(cell); cell = ""; closed = false; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = ""; closed = false;
    } else if (c === '"' && cell === "" && !closed) quoted = true;
    else { if (closed || c === '"') throw new Error("Invalid CSV quoting. Save the file as a comma-separated CSV."); cell += c; }
  }
  if (quoted) throw new Error("The CSV contains an unclosed quotation mark.");
  if (cell !== "" || row.length || closed) { row.push(cell); rows.push(row); }
  return rows;
}

const fields = ["category", "name", "description", "duration", "price", "rebook_window", "guarantee_required", "patch_required"];
const labels = treatmentHeaders.slice(1);
const normal = (t, field) => field === "price" || field === "duration" ? Number(t[field]) : field === "guarantee_required" ? t[field] !== false : field === "patch_required" ? !!t[field] : t[field] || "";
export function validateTreatmentCsv(text, treatments) {
  const errors = [], changes = [], updates = [], seen = new Set();
  let rows;
  try { rows = readCsv(text); } catch (e) { return { errors: [e.message], changes, updates }; }
  if (!rows.length || rows[0].length !== treatmentHeaders.length || rows[0].some((h, i) => h !== treatmentHeaders[i]))
    return { errors: ["The headers must match the required fields exactly, in the displayed order. Use Download Treatments CSV as your template."], changes, updates };
  rows = rows.slice(1).filter(r => r.some(v => v.trim() !== ""));
  if (!rows.length || rows.length > 2000) return { errors: ["Include between 1 and 2,000 treatment rows."], changes, updates };
  const current = new Map(treatments.map(t => [t.id, t]));
  rows.forEach((r, index) => {
    const beforeErrors = errors.length, prefix = `Row ${index + 2}: `;
    if (r.length !== treatmentHeaders.length) { errors.push(prefix + "expected 9 comma-separated fields."); return; }
    const [rawId, category, name, description, duration, price, rebook, guarantee, patch] = r.map(v => v.trim());
    const id = Number(rawId), old = current.get(id);
    if (!/^\d+$/.test(rawId) || id < 1 || id > 2147483647 || !old) errors.push(prefix + "Treatment ID must match an existing active treatment.");
    if (seen.has(id)) errors.push(prefix + `Treatment ID ${rawId} is duplicated.`);
    seen.add(id);
    if (!category || category.length > 200) errors.push(prefix + "Category must contain 1–200 characters.");
    if (!name || name.length > 200) errors.push(prefix + "Treatment Name must contain 1–200 characters.");
    if (description.length > 5000) errors.push(prefix + "Description exceeds 5,000 characters.");
    if (!/^\d+$/.test(duration) || Number(duration) < 1 || Number(duration) > 720) errors.push(prefix + "Length must be a whole number from 1 to 720 minutes.");
    if (!/^\d+(\.\d{1,2})?$/.test(price) || Number(price) >= 1000000) errors.push(prefix + "Price must be a number from 0 to 999999.99, without € symbols.");
    if (rebook && !rebookWindows.includes(rebook.toLowerCase())) errors.push(prefix + "Choose one of the listed Rebook Window values, or leave it blank.");
    for (const [value, label] of [[guarantee, "Booking guarantee"], [patch, "Patch test"]])
      if (value && !["yes", "no"].includes(value.toLowerCase())) errors.push(prefix + `${label} must be Yes, No or blank (keep current setting).`);
    if (errors.length !== beforeErrors || !old) return;
    const next = { id, revision: old.revision ?? 0, category, name, description: r[3], duration: Number(duration), price: Number(price), rebook_window: rebook.toLowerCase() || null,
      guarantee_required: guarantee ? guarantee.toLowerCase() === "yes" : old.guarantee_required !== false,
      patch_required: patch ? patch.toLowerCase() === "yes" : !!old.patch_required };
    updates.push(next);
    fields.forEach((field, i) => {
      if (normal(old, field) !== normal(next, field)) changes.push({ id, treatment: old.name, field: labels[i], before: normal(old, field), after: normal(next, field) });
    });
  });
  return { errors, changes, updates };
}

export function exportTreatmentCsv(treatments) {
  const quote = v => '"' + String(v ?? "").replaceAll('"', '""') + '"';
  return '\uFEFF' + [treatmentHeaders, ...treatments.map(t => [t.id, t.category, t.name, t.description || "", t.duration, Number(t.price).toFixed(2), t.rebook_window || "", t.guarantee_required === false ? "No" : "Yes", t.patch_required ? "Yes" : "No"])].map(r => r.map(quote).join(',')).join('\r\n') + '\r\n';
}
