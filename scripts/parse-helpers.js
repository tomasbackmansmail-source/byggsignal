// scripts/parse-helpers.js
// Delade hjälpfunktioner för alla scrapers

function parsePermitType(text) {
  const t = (text || '').toLowerCase();
  if (/rivningslov|rivning av/.test(t)) return 'rivningslov';
  if (/marklov|ändring av marknivå|schaktning|fyllning/.test(t)) return 'marklov';
  if (/förhandsbesked/.test(t)) return 'förhandsbesked';
  if (/strandskyddsdispens|strandskydd/.test(t)) return 'strandskyddsdispens';
  if (/anmälan|anmälningspliktig/.test(t)) return 'anmälan';
  return 'bygglov';
}

function parseStatus(text, defaultStatus = null) {
  const t = (text || '').toLowerCase();
  if (/startbesked/.test(t)) return 'startbesked';
  if (/avslag/.test(t)) return 'avslag';
  if (/beviljat|beviljad|beviljas|beslut om|kungörelse/.test(t)) return 'beviljat';
  if (/grannhörande|grannehörande|underrättelse|ansökan om|ansökt|inför beslut/.test(t)) return 'ansökt';
  return defaultStatus;
}

module.exports = { parsePermitType, parseStatus };
