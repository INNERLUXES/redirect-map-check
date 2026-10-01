// Report formats: text for a terminal, Markdown for a pull request or job summary, JSON for other tools, CSV for a spreadsheet.

function inputs(r) {
  const s = r.sources;
  if (!s) return 'redirect map';
  return `old ${s.old}, new ${s.new}, map ${s.map}${s.mapFormat ? ` (${s.mapFormat})` : ''}`;
}

function summaryLine(r) {
  const s = r.summary;
  return `old URLs: ${s.oldUrls} (${s.kept} kept, ${s.redirected} redirected, ${s.unmapped} unmapped); new URLs: ${s.newUrls} (${s.newOnly} new-only); redirects: ${s.redirects}`;
}

function findingSummary(r) {
  const shown = r.shown < r.total ? `showing the first ${r.shown} of ${r.total} (--limit)` : `${r.total} shown`;
  return `${r.counts.error} error, ${r.counts.warning} warning, ${r.counts.info} info (${shown})`;
}

export function toText(r) {
  const lines = [
    `redirect-map-check: ${inputs(r)}`,
    summaryLine(r),
    `findings: ${findingSummary(r)}`
  ];
  if (!r.findings.length) lines.push('', 'no findings');
  for (const f of r.findings) lines.push('', `${f.severity.toUpperCase().padEnd(8)}  ${f.id.padEnd(20)}  ${f.message}`);
  if (r.notes.length) lines.push('');
  for (const n of r.notes) lines.push(`note: ${n}`);
  lines.push('', r.gate.pass ? `GATE: PASS (--fail-on ${r.gate.failOn})` : `GATE: FAIL - ${r.gate.reason}`);
  return lines.join('\n') + '\n';
}

// A Markdown table cell: backslashes and pipes escaped, line breaks flattened, so text from a map cannot break the table.
export function mdCell(t) {
  return String(t).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n|\r/g, ' ');
}

export function toMarkdown(r) {
  const lines = [
    `## redirect-map-check: ${r.counts.error} error, ${r.counts.warning} warning, ${r.counts.info} info`,
    '',
    `${mdCell(inputs(r))}.`,
    '',
    `${mdCell(summaryLine(r))}. Findings: ${mdCell(findingSummary(r))}.`
  ];
  if (!r.findings.length) lines.push('', 'No findings.');
  else {
    lines.push('', '| Severity | Check | Line | Message |', '| --- | --- | --- | --- |');
    for (const f of r.findings) lines.push(`| ${f.severity} | ${mdCell(f.id)} | ${f.line ?? ''} | ${mdCell(f.message)} |`);
  }
  if (r.notes.length) lines.push('');
  for (const n of r.notes) lines.push(`- ${mdCell(n)}`);
  lines.push('', r.gate.pass ? `**Gate passed** (--fail-on ${r.gate.failOn}).` : `**Gate failed:** ${mdCell(r.gate.reason)}.`);
  return lines.join('\n') + '\n';
}

export function toJson(r) {
  return JSON.stringify(r, null, 2) + '\n';
}

// RFC 4180 quoting, and a leading quote on cells a spreadsheet would read as a formula.
export function csvCell(value) {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// One row per finding shown.
export function toCsv(r) {
  const rows = [['severity', 'id', 'line', 'from', 'to', 'message']];
  for (const f of r.findings) rows.push([f.severity, f.id, f.line, f.from, f.to, f.message]);
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
