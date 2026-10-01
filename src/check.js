// Checks a redirect map against the old and the new site's URLs.
// docs/method.md gives the reason behind every check, with the Google Search Central and RFC 9110 text it follows.

import { normalizeUrl } from './url.js';

export const SEVERITIES = ['error', 'warning', 'info'];
export const RANK = { error: 0, warning: 1, info: 2 };
export const MAX_HOPS = 20;
export const PERMANENT = [301, 308];

export const FINDINGS = [
  { id: 'unmapped', severity: 'error', what: 'An old URL is not on the new site and has no redirect' },
  { id: 'target-missing', severity: 'error', what: 'A redirect target is not on the new site and is not itself redirected' },
  { id: 'loop', severity: 'error', what: 'Redirects that lead back to a URL already passed' },
  { id: 'duplicate-source', severity: 'error', what: 'The same old URL is mapped twice, to different targets' },
  { id: 'self-redirect', severity: 'error', what: 'A redirect whose target is its own source' },
  { id: 'chain', severity: 'warning / error', what: 'A redirect leads to another redirect; the full chain and the direct target are given; an error after 20 hops' },
  { id: 'to-home', severity: 'warning / error', what: 'Old pages redirected to the home page; an error when more than --home-limit do' },
  { id: 'status-not-permanent', severity: 'warning', what: 'A temporary redirect (302, 303, 307) where a permanent one (301, 308) is expected' },
  { id: 'unsupported', severity: 'warning', what: 'A line of the map in a form the tool does not read, such as a regular expression rule; never guessed' },
  { id: 'case-or-slash-only', severity: 'info', what: 'Redirects that only change the case or a trailing slash' },
  { id: 'kept', severity: 'info', what: 'Old URLs that exist unchanged on the new site, counted' },
  { id: 'new-only', severity: 'info', what: 'New URLs that are not on the old site and that no redirect points to, counted' }
];

const ORDER = Object.fromEntries(FINDINGS.map((f, i) => [f.id, i]));

export function isFindingId(id) {
  return Object.hasOwn(ORDER, id);
}

// Text from the input: control and direction characters removed and length capped, so it cannot rewrite a terminal.
export function safeText(value, max = 300) {
  const s = String(value).replace(/[\u0000-\u001f\u007f-\u009f\u200E\u200F\u2028\u2029\u202A-\u202E\u2066-\u2069]/g, ' ');
  return s.length > max ? `${s.slice(0, max - 3)}...` : s;
}

export function meetsThreshold(severity, failOn) {
  return RANK[severity] <= RANK[failOn];
}

function plural(n, one, many = `${one}s`) {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
}

function quoteList(items, max = 5) {
  const shown = items.slice(0, max).join(', ');
  return items.length > max ? `${shown} and ${(items.length - max).toLocaleString('en-US')} more` : shown;
}

const at = (rule) => (rule.line ? ` (line ${rule.line})` : '');

// Checks one redirect map.
//   input    { old, new, rules, unsupported }: the URLs as text, the redirects as { from, to, status, line },
//            and the map lines that were not read as { line, text, reason }
//   options  keepHost, strictSlash, caseInsensitive, homeLimit, limit, failOn, maxHops, notes, sources
export function checkMap(input, options = {}) {
  const o = { keepHost: false, strictSlash: false, caseInsensitive: false, homeLimit: 10, limit: 200, failOn: 'error', maxHops: MAX_HOPS, notes: [], sources: null, ...options };
  const norm = (u) => normalizeUrl(u, o);
  const findings = [];
  const notes = [...o.notes];
  const add = (id, severity, message, extra = {}) => findings.push({
    id, severity, line: extra.line ?? null, from: extra.from ?? null, to: extra.to ?? null, message: safeText(message, 1200)
  });
  const show = (u) => safeText(u, 300);

  function urlSet(list, label) {
    const map = new Map();
    const invalid = [];
    let repeated = 0;
    for (const raw of list || []) {
      const n = norm(raw);
      if (n.error) invalid.push(`"${show(raw)}" (${n.error})`);
      else if (map.has(n.key)) repeated += 1;
      else map.set(n.key, n);
    }
    if (invalid.length) notes.push(`${plural(invalid.length, 'line')} of the ${label} URL file could not be read as a web address and ${invalid.length === 1 ? 'was' : 'were'} left out: ${quoteList(invalid, 3)}`);
    if (repeated) notes.push(`${plural(repeated, 'URL')} of the ${label} URL file appear more than once after normalisation and are counted once`);
    return map;
  }
  const oldSet = urlSet(input.old, 'old');
  const newSet = urlSet(input.new, 'new');

  for (const u of input.unsupported || []) {
    add('unsupported', 'warning', `line ${u.line}: ${u.reason}: ${safeText(u.text, 200)}`, { line: u.line });
  }

  // Rules grouped by their source; the first rule for a source is the one that counts.
  const bySource = new Map();
  for (const r of input.rules || []) {
    const f = norm(r.from);
    const t = norm(r.to);
    if (f.error || t.error) {
      const which = f.error ? `source "${show(r.from)}": ${f.error}` : `target "${show(r.to)}": ${t.error}`;
      add('unsupported', 'warning', `line ${r.line ?? '?'}: the ${which}`, { line: r.line ?? null });
      continue;
    }
    const rule = { from: r.from, to: r.to, status: r.status ?? null, line: r.line ?? null, f, t };
    if (!bySource.has(f.key)) bySource.set(f.key, []);
    bySource.get(f.key).push(rule);
  }

  const edges = new Map();
  const effective = [];
  let sameTarget = 0;
  let hostOnly = 0;
  const homeRules = [];
  for (const [key, list] of bySource) {
    const rule = list[0];
    effective.push(rule);
    const others = list.slice(1).filter((r) => r.t.key !== rule.t.key);
    sameTarget += list.length - 1 - others.length;
    if (others.length) {
      const targets = [rule, ...others].map((r) => `${r.t.key}${at(r)}`);
      add('duplicate-source', 'error', `${key} is mapped ${list.length} times, to different targets: ${quoteList(targets)}; the first one is used in the other checks`, { line: rule.line, from: key });
    }
    if (rule.f.full === rule.t.full) {
      add('self-redirect', 'error', `${key} redirects to itself${at(rule)}; a browser that follows it never arrives`, { line: rule.line, from: key, to: rule.t.key });
      continue;
    }
    if (rule.f.exact === rule.t.exact) hostOnly += 1;
    else if (rule.f.loose === rule.t.loose) {
      add('case-or-slash-only', 'info', `${rule.f.exact} -> ${rule.t.exact}${at(rule)} only changes the case or a trailing slash`, { line: rule.line, from: rule.f.exact, to: rule.t.exact });
    }
    if (rule.status !== null && !PERMANENT.includes(rule.status)) {
      add('status-not-permanent', 'warning', `${key} -> ${rule.t.key}${at(rule)} is a ${rule.status}, a temporary redirect; a site move needs a permanent 301 or 308`, { line: rule.line, from: key, to: rule.t.key });
    }
    if (rule.t.home && !rule.f.home) homeRules.push(rule);
    if (rule.t.key !== key) edges.set(key, rule);
  }
  if (sameTarget) notes.push(`${plural(sameTarget, 'redirect')} repeat an earlier one with the same source and target`);
  if (hostOnly) notes.push(`${plural(hostOnly, 'redirect')} change only the scheme or the host, which is not compared without --keep-host`);

  // Follow every redirect to its end.
  const loops = new Set();
  for (const [key, rule] of edges) {
    const path = [key];
    const seen = new Set(path);
    let cur = rule.t.key;
    let outcome = 'end';
    while (edges.has(cur)) {
      if (seen.has(cur)) {
        outcome = 'loop';
        break;
      }
      if (path.length >= o.maxHops) {
        outcome = 'limit';
        break;
      }
      seen.add(cur);
      path.push(cur);
      cur = edges.get(cur).t.key;
    }
    if (outcome === 'loop') {
      const cycle = path.slice(path.indexOf(cur));
      const id = [...cycle].sort().join('\n');
      if (!loops.has(id)) {
        loops.add(id);
        const first = edges.get(cycle[0]);
        add('loop', 'error', `redirect loop: ${[...cycle, cycle[0]].join(' -> ')}${at(first)}; none of these URLs can be reached`, { line: first.line, from: cycle[0], to: cycle[0] });
      }
    } else if (outcome === 'limit') {
      add('chain', 'error', `${key}${at(rule)} starts a chain of more than ${o.maxHops} redirects; following stopped at ${cur}. Browsers and crawlers give up on chains this long`, { line: rule.line, from: key, to: cur });
    } else if (path.length > 1) {
      add('chain', 'warning', `${[...path, cur].join(' -> ')}${at(rule)}: ${path.length} redirects in a row; redirect ${key} straight to ${cur}`, { line: rule.line, from: key, to: cur });
    }
  }

  // Targets that lead nowhere.
  for (const rule of effective) {
    if (rule.f.full === rule.t.full) continue;
    if (!edges.has(rule.t.key) && !newSet.has(rule.t.key)) {
      add('target-missing', 'error', `${rule.f.key} -> ${rule.t.key}${at(rule)}: the target is not on the new site and is not redirected`, { line: rule.line, from: rule.f.key, to: rule.t.key });
    }
  }

  if (homeRules.length) {
    const many = homeRules.length > o.homeLimit;
    add('to-home', many ? 'error' : 'warning',
      `${plural(homeRules.length, 'old page')} ${homeRules.length === 1 ? 'is' : 'are'} redirected to the home page: ${quoteList(homeRules.map((r) => `${r.f.key}${at(r)}`))}. Google treats such redirects as soft 404s; send each to its closest new page (more than ${o.homeLimit} is an error, --home-limit)`,
      { line: homeRules[0].line, from: homeRules[0].f.key, to: '/' });
  }

  // Old URLs.
  let kept = 0;
  let redirected = 0;
  let unmapped = 0;
  for (const key of oldSet.keys()) {
    if (bySource.has(key)) redirected += 1;
    else if (newSet.has(key)) kept += 1;
    else {
      unmapped += 1;
      add('unmapped', 'error', `${key} is not on the new site and has no redirect`, { from: key });
    }
  }
  let keptAndRedirected = 0;
  for (const key of oldSet.keys()) if (bySource.has(key) && newSet.has(key)) keptAndRedirected += 1;
  if (keptAndRedirected) notes.push(`${plural(keptAndRedirected, 'old URL')} ${keptAndRedirected === 1 ? 'is' : 'are'} on the new site and also redirected; the redirect wins, so the new page at that address cannot be reached`);
  if (kept) add('kept', 'info', `${plural(kept, 'old URL')} ${kept === 1 ? 'exists' : 'exist'} unchanged on the new site and need${kept === 1 ? 's' : ''} no redirect`);

  const targets = new Set(effective.map((r) => r.t.key));
  const newOnly = [...newSet.keys()].filter((k) => !oldSet.has(k) && !targets.has(k));
  if (newOnly.length) {
    add('new-only', 'info', `${plural(newOnly.length, 'new URL')} ${newOnly.length === 1 ? 'is' : 'are'} not on the old site and no redirect points to ${newOnly.length === 1 ? 'it' : 'them'}: ${quoteList(newOnly)}`);
  }

  const extra = [...bySource.keys()].filter((k) => !oldSet.has(k));
  if (extra.length && oldSet.size) notes.push(`${plural(extra.length, 'redirect source')} ${extra.length === 1 ? 'is' : 'are'} not in the old URL file: ${quoteList(extra, 5)}`);
  if (!effective.length) notes.push('the redirect map holds no redirect the tool could read');

  findings.sort((a, b) => RANK[a.severity] - RANK[b.severity] || ORDER[a.id] - ORDER[b.id]);
  const counts = { error: 0, warning: 0, info: 0 };
  const byCheck = Object.fromEntries(FINDINGS.map((f) => [f.id, 0]));
  for (const f of findings) {
    counts[f.severity] += 1;
    byCheck[f.id] += 1;
  }
  const failing = findings.filter((f) => meetsThreshold(f.severity, o.failOn));
  const errors = failing.filter((f) => f.severity === 'error').length;
  const warnings = failing.length - errors;
  const reason = [errors ? plural(errors, 'error') : '', warnings ? plural(warnings, 'warning') : ''].filter(Boolean).join(' and ');

  return {
    tool: 'redirect-map-check',
    sources: o.sources ? Object.fromEntries(Object.entries(o.sources).map(([k, v]) => [k, safeText(v, 300)])) : null,
    options: { keepHost: o.keepHost, strictSlash: o.strictSlash, caseInsensitive: o.caseInsensitive, homeLimit: o.homeLimit },
    summary: {
      oldUrls: oldSet.size, newUrls: newSet.size, redirects: effective.length,
      kept, redirected, unmapped, newOnly: newOnly.length
    },
    counts,
    byCheck,
    total: findings.length,
    shown: Math.min(findings.length, o.limit),
    findings: findings.slice(0, o.limit),
    notes: notes.map((n) => safeText(n, 1200)),
    gate: { failOn: o.failOn, pass: failing.length === 0, reason: failing.length ? reason : '' }
  };
}
