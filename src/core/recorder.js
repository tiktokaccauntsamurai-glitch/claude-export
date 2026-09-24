import { patternOf } from './scrub.js';

// Pure helpers for the "record endpoints while I browse claude.ai" feature.

export function recordEntry(log, d) {
  if (!/^https:\/\/claude\.ai\/api\//.test(d.url)) return log;
  const pattern = patternOf(d.url);
  const key = `${d.method} ${pattern}`;
  const u = new URL(d.url);
  const e = (log[key] ??= { method: d.method, pattern, example: u.pathname + u.search, statuses: {}, count: 0 });
  e.count++;
  e.statuses[d.statusCode] = (e.statuses[d.statusCode] || 0) + 1;
  return log;
}

const SKIP = /completion|logout|event|telemetry|analytics|stream|\bsse\b|statsig|segment|sentry|prefetch|_log|heartbeat|ping/i;
const CONV_DETAIL = /^\/api\/organizations\/\{id\}\/chat_conversations\/\{id\}(\?|$)/;

// GET endpoints that answered 2xx and are worth replaying to learn their JSON structure.
export function selectReplayTargets(log, max = 60) {
  return Object.values(log)
    .filter(e => e.method === 'GET' && (e.statuses[200] || e.statuses[304]) && !SKIP.test(e.pattern) && !CONV_DETAIL.test(e.pattern))
    .slice(0, max);
}

// Header NAMES only (never values) of requests the page itself makes: helps when a replay of a URL gets 404
// because the site sends extra headers.
export function recordHeaders(log, d) {
  if (!/^https:\/\/claude\.ai\/api\//.test(d.url)) return log;
  const pattern = patternOf(d.url);
  const u = new URL(d.url);
  const e = (log[`${d.method} ${pattern}`] ??= { method: d.method, pattern, example: u.pathname + u.search, statuses: {}, count: 0 });
  const names = new Set(e.headerNames || []);
  for (const h of d.requestHeaders || []) names.add(String(h.name).toLowerCase());
  e.headerNames = [...names].sort();
  return log;
}
