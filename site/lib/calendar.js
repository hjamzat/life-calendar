// Calendar math shared by the site (browser) and the worker.
// Dates are "civil days": epoch milliseconds of UTC midnight for that day.
// Hijri dates use Intl's `islamic-umalqura` (official Saudi Umm al-Qura).

export const DAY = 86_400_000;

const fmtCache = new Map();
function fmt(calendar, opts, timeZone = "UTC") {
  const key = calendar + timeZone + JSON.stringify(opts);
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(`en-u-ca-${calendar}-nu-latn`, { timeZone, ...opts });
    fmtCache.set(key, f);
  }
  return f;
}

function numericParts(f, date) {
  const out = {};
  for (const p of f.formatToParts(date)) {
    if (p.type === "year" || p.type === "month" || p.type === "day") out[p.type] = Number(p.value);
  }
  return { y: out.year, m: out.month, d: out.day };
}

/** Civil day for an ISO "YYYY-MM-DD" (Gregorian) string. */
export function fromISO(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "");
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  return Number.isNaN(t) ? null : t;
}

export function toISO(t) {
  return new Date(t).toISOString().slice(0, 10);
}

/** Today's civil day in an IANA time zone. */
export function today(timeZone = "UTC", now = new Date()) {
  let p;
  try {
    p = numericParts(fmt("gregory", { year: "numeric", month: "numeric", day: "numeric" }, timeZone), now);
  } catch {
    p = numericParts(fmt("gregory", { year: "numeric", month: "numeric", day: "numeric" }), now);
  }
  return Date.UTC(p.y, p.m - 1, p.d);
}

/** {y, m, d} of a civil day in the given calendar ("hijri" | "gregory"). */
export function parts(cal, t) {
  if (cal === "gregory") {
    const d = new Date(t);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
  }
  return numericParts(fmt("islamic-umalqura", { year: "numeric", month: "numeric", day: "numeric" }), new Date(t));
}

const HIJRI_MONTHS = [
  "Muharram", "Safar", "Rabi al-Awwal", "Rabi al-Thani", "Jumada al-Ula", "Jumada al-Akhirah",
  "Rajab", "Shaban", "Ramadan", "Shawwal", "Dhu al-Qadah", "Dhu al-Hijjah",
];
const GREG_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function monthName(cal, m) {
  return (cal === "gregory" ? GREG_MONTHS : HIJRI_MONTHS)[m - 1];
}

export function formatDate(cal, t) {
  const p = parts(cal, t);
  return cal === "gregory"
    ? `${monthName(cal, p.m)} ${p.d}, ${p.y}`
    : `${p.d} ${monthName(cal, p.m)} ${p.y} AH`;
}

export function yearLabel(cal, y) {
  return cal === "gregory" ? String(y) : `${y} AH`;
}

/** First civil day of the month containing t. */
export function monthStart(cal, t) {
  return t - (parts(cal, t).d - 1) * DAY;
}

/** First civil day of the month after the one containing t. */
function nextMonthStart(cal, t) {
  return monthStart(cal, monthStart(cal, t) + 32 * DAY);
}

/** Start (inclusive) and end (exclusive) of the year containing t. */
export function yearBounds(cal, t) {
  if (cal === "gregory") {
    const y = parts(cal, t).y;
    return { start: Date.UTC(y, 0, 1), end: Date.UTC(y + 1, 0, 1) };
  }
  let start = monthStart(cal, t);
  while (parts(cal, start).m !== 1) start = monthStart(cal, start - DAY);
  let end = nextMonthStart(cal, start);
  while (parts(cal, end).m !== 1) end = nextMonthStart(cal, end);
  return { start, end };
}

/** Start/end of the quarter (months 1-3, 4-6, 7-9, 10-12) containing t, plus its number. */
export function quarterBounds(cal, t) {
  const q = Math.ceil(parts(cal, t).m / 3);
  let start = monthStart(cal, t);
  while ((parts(cal, start).m - 1) % 3 !== 0) start = monthStart(cal, start - DAY);
  let end = start;
  for (let i = 0; i < 3; i++) end = nextMonthStart(cal, end);
  return { start, end, q };
}

/**
 * Convert a date given in `cal` to a civil day. Returns null if the date does
 * not exist (e.g. 30th of a 29-day Hijri month).
 */
export function fromParts(cal, y, m, d) {
  if (cal === "gregory") {
    const t = Date.UTC(y, m - 1, d);
    const p = parts(cal, t);
    return p.y === y && p.m === m && p.d === d ? t : null;
  }
  // Estimate from a known anchor (1 Muharram 1447 = 2025-06-26), then search nearby.
  const anchor = Date.UTC(2025, 5, 26);
  const approx = anchor + Math.round((y - 1447) * 354.36707 + (m - 1) * 29.530588 + (d - 1)) * DAY;
  for (let off = 0; off <= 6; off++) {
    for (const t of off ? [approx + off * DAY, approx - off * DAY] : [approx]) {
      const p = parts(cal, t);
      if (p.y === y && p.m === m && p.d === d) return t;
    }
  }
  return null;
}

/** Number of days in a month of `cal`. */
export function monthLength(cal, y, m) {
  const start = fromParts(cal, y, m, 1);
  if (start == null) return null;
  return (nextMonthStart(cal, start) - start) / DAY;
}

/**
 * Compute what a wallpaper view should show.
 * Returns { total, elapsed, title, subtitle, groups } where `elapsed` is the
 * number of fully passed days (today's dot index) and `groups` are dot counts
 * per month (for spacing), or null.
 */
export function computeView({ view, cal, tz, start, end, title }) {
  const t = today(tz);
  if (view === "goal") {
    const s = start ?? t;
    const e = end;
    if (e == null || e <= s) throw new Error("goal needs end date after start");
    const total = Math.round((e - s) / DAY);
    if (total > 3660) throw new Error("goal range is limited to 10 years");
    const elapsed = clamp(Math.round((t - s) / DAY), 0, total);
    const left = total - elapsed;
    return {
      total,
      elapsed,
      title: title || "Goal",
      subtitle: `${formatDate(cal, e)}`,
      footer: left === 0 ? "Done" : `${left}d left · ${pct(elapsed, total)}%`,
      groups: null,
    };
  }

  const b = view === "quarter" ? quarterBounds(cal, t) : yearBounds(cal, t);
  const total = Math.round((b.end - b.start) / DAY);
  const elapsed = Math.round((t - b.start) / DAY);
  const p = parts(cal, t);
  const groups = [];
  for (let m = b.start; m < b.end; m = nextMonthStart(cal, m)) {
    groups.push(Math.round((Math.min(nextMonthStart(cal, m), b.end) - m) / DAY));
  }
  const left = total - elapsed;
  return {
    total,
    elapsed,
    title: view === "quarter" ? `Q${b.q} · ${yearLabel(cal, p.y)}` : yearLabel(cal, p.y),
    subtitle: formatDate(cal, t),
    footer: `${left}d left · ${pct(elapsed, total)}%`,
    groups,
  };
}

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

function pct(a, b) {
  return Math.floor((a / b) * 100);
}
