// Shared DOM text-setting helpers (docs/strategy/technical_debt/01_duplicate_code.md D9).

// Leaves the element untouched when value is null/undefined, so callers can
// layer multiple passes (static -> override -> JSON) without blanking text
// that a later pass doesn't have data for.
function setText(id, value) {
  const el = document.getElementById(id);
  if (el && value != null) el.textContent = value;
}

// Always writes, falling back to an em dash placeholder for empty values.
// For "info row" style displays that should never look broken/blank.
function setTextOrDash(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value || "—";
}
