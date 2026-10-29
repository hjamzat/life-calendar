// Calendar math shared by the site (browser) and the worker.
// Dates are "civil days": epoch milliseconds of UTC midnight for that day.
// Hijri dates use Intl's `islamic-umalqura` (official Saudi Umm al-Qura).

import { TZ_ALIASES, TZ_CITIES } from "./tz-cities.js";

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

const RAD = Math.PI / 180;

/**
 * Sunset (sun's upper limb at the horizon, standard -0.833\u00b0 refraction) for
 * civil day `t` at latitude/longitude (east positive), as epoch ms.
 * Uses the NOAA/Wikipedia sunrise equation; accurate to about a minute.
 * Returns null when the sun does not set or rise that day (polar regions).
 */
export function sunset(t, lat, lon) {
  // days since J2000.0 at local mean solar noon of that civil date
  const jstar = t / DAY + 2440587.5 - 2451545.0 + 0.5 - lon / 360;
  const M = (357.5291 + 0.98560028 * jstar) % 360;
  const C = 1.9148 * Math.sin(M * RAD) + 0.02 * Math.sin(2 * M * RAD) + 0.0003 * Math.sin(3 * M * RAD);
  const lambda = (M + C + 180 + 102.9372) % 360;
  const transit = jstar + 0.0053 * Math.sin(M * RAD) - 0.0069 * Math.sin(2 * lambda * RAD);
  const sinDec = Math.sin(lambda * RAD) * Math.sin(23.4397 * RAD);
  const cosDec = Math.cos(Math.asin(sinDec));
  const cosH = (Math.sin(-0.833 * RAD) - Math.sin(lat * RAD) * sinDec) / (Math.cos(lat * RAD) * cosDec);
  if (cosH < -1 || cosH > 1) return null;
  const set = transit + Math.acos(cosH) / RAD / 360;
  return Math.round((set + 2451545.0 - 2440587.5) * DAY);
}

/**
 * Where sunset is calculated: the given coordinates, else the reference city
 * of the time zone (tzdata zone.tab, e.g. Europe/Moscow → Moscow).
 * `city` is that city's name, or null for explicit coordinates.
 * Returns null for zones without a city (UTC, Etc/*).
 */
export function sunsetPlace({ tz, lat, lon }) {
  if (lat != null && lon != null) return { lat, lon, city: null };
  const zone = TZ_ALIASES[tz] ?? tz;
  const c = TZ_CITIES[zone];
  if (!c) return null;
  return { lat: c[0], lon: c[1], city: zone.slice(zone.lastIndexOf("/") + 1).replaceAll("_", " ") };
}

/**
 * The civil day whose date the wallpaper should show right now.
 * The Hijri day begins at sunset (Maghrib), so after sunset the Hijri
 * calendar moves to the next date. With `dayStart: "midnight"`, for the
 * Gregorian calendar, or when there is no sunset place, it is the civil date.
 */
export function effectiveToday({ cal, tz, lat, lon, dayStart, now = new Date() }) {
  const t = today(tz, now);
  if (cal !== "hijri" || dayStart === "midnight") return t;
  const place = sunsetPlace({ tz, lat, lon });
  if (!place) return t;
  const s = sunset(t, place.lat, place.lon);
  return s != null && now.getTime() >= s ? t + DAY : t;
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
  "Muharram", "Safar", "Rabi\u2019 al-Awwal", "Rabi\u2019 al-Thani", "Jumada al-Awwal", "Jumada al-Thani",
  "Rajab", "Sha\u2019aban", "Ramadan", "Shawwal", "Dhu al-Qi\u2019dah", "Dhu al-Hijjah",
];
const GREG_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function monthName(cal, m) {
  return (cal === "gregory" ? GREG_MONTHS : HIJRI_MONTHS)[m - 1];
}

// Labels for month blocks on the wallpaper: Hijri names in full (they fit
// above a 7-dot block), Gregorian abbreviated.
export function shortMonthName(cal, m) {
  return cal === "gregory" ? GREG_MONTHS[m - 1].slice(0, 3) : HIJRI_MONTHS[m - 1];
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
 * Returns { total, elapsed, title, subtitle, footer, months, quarters } where
 * `elapsed` is the number of fully passed days (today's dot index) and
 * `months` / `quarters` are consecutive segments { label, start, days } of the
 * period (null when not applicable), used by the block layouts.
 */
export function computeView({ view, cal, tz, start, end, title, lat, lon, dayStart, now }) {
  const t = effectiveToday({ cal, tz, lat, lon, dayStart, now });
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
      months: null,
      quarters: null,
    };
  }

  const b = view === "quarter" ? quarterBounds(cal, t) : yearBounds(cal, t);
  const total = Math.round((b.end - b.start) / DAY);
  const elapsed = Math.round((t - b.start) / DAY);
  const p = parts(cal, t);
  const months = [];
  for (let m = b.start; m < b.end; m = nextMonthStart(cal, m)) {
    const next = Math.min(nextMonthStart(cal, m), b.end);
    months.push({ label: shortMonthName(cal, parts(cal, m).m), start: m, days: Math.round((next - m) / DAY) });
  }
  let quarters = null;
  if (view === "year") {
    quarters = [];
    for (let i = 0; i < months.length; i += 3) {
      const group = months.slice(i, i + 3);
      quarters.push({ label: `Q${i / 3 + 1}`, start: group[0].start, days: group.reduce((s, x) => s + x.days, 0) });
    }
  }
  const left = total - elapsed;
  return {
    total,
    elapsed,
    title: view === "quarter" ? `Q${b.q} · ${yearLabel(cal, p.y)}` : yearLabel(cal, p.y),
    subtitle: formatDate(cal, t),
    footer: `${left}d left · ${pct(elapsed, total)}%`,
    months,
    quarters,
  };
}

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

function pct(a, b) {
  return Math.floor((a / b) * 100);
}
