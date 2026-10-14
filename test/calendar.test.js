import assert from "node:assert/strict";
import { test } from "node:test";
import {
  computeView,
  DAY,
  fromISO,
  fromParts,
  monthLength,
  parts,
  quarterBounds,
  toISO,
  yearBounds,
} from "../site/lib/calendar.js";

test("known Umm al-Qura dates", () => {
  assert.equal(toISO(fromParts("hijri", 1447, 9, 1)), "2026-02-18"); // 1 Ramadan 1447
  assert.equal(toISO(fromParts("hijri", 1448, 1, 1)), "2026-06-16"); // 1 Muharram 1448
  assert.deepEqual(parts("hijri", fromISO("2026-02-18")), { y: 1447, m: 9, d: 1 });
});

test("fromParts round-trips every day for 1440..1460 AH", () => {
  for (let t = fromParts("hijri", 1440, 1, 1); parts("hijri", t).y < 1460; t += DAY) {
    const p = parts("hijri", t);
    assert.equal(fromParts("hijri", p.y, p.m, p.d), t);
  }
});

test("invalid dates return null", () => {
  const short = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].find((m) => monthLength("hijri", 1447, m) === 29);
  assert.equal(fromParts("hijri", 1447, short, 30), null);
  assert.equal(fromParts("gregory", 2026, 2, 30), null);
});

test("Hijri year bounds are 354 or 355 days and start on 1 Muharram", () => {
  for (let y = 1440; y <= 1460; y++) {
    const { start, end } = yearBounds("hijri", fromParts("hijri", y, 6, 10));
    assert.deepEqual(parts("hijri", start), { y, m: 1, d: 1 });
    assert.deepEqual(parts("hijri", end), { y: y + 1, m: 1, d: 1 });
    assert.ok([354, 355].includes((end - start) / DAY), `year ${y}`);
  }
});

test("quarters cover months 1-3, 4-6, 7-9, 10-12", () => {
  for (const cal of ["hijri", "gregory"]) {
    for (let m = 1; m <= 12; m++) {
      const t = cal === "hijri" ? fromParts(cal, 1448, m, 15) : Date.UTC(2026, m - 1, 15);
      const { start, end, q } = quarterBounds(cal, t);
      assert.equal(q, Math.ceil(m / 3));
      assert.equal(parts(cal, start).m, (q - 1) * 3 + 1);
      assert.equal(parts(cal, start).d, 1);
      assert.equal(parts(cal, end).m, (q % 4) * 3 + 1);
      assert.ok(t >= start && t < end);
    }
  }
});

test("Gregorian year", () => {
  const { start, end } = yearBounds("gregory", fromISO("2028-07-01"));
  assert.equal(toISO(start), "2028-01-01");
  assert.equal((end - start) / DAY, 366);
});

test("views produce consistent counts", () => {
  for (const view of ["year", "quarter"]) {
    for (const cal of ["hijri", "gregory"]) {
      const v = computeView({ view, cal, tz: "Asia/Riyadh" });
      assert.ok(v.elapsed >= 0 && v.elapsed < v.total);
      assert.equal(v.months.reduce((a, s) => a + s.days, 0), v.total);
      if (view === "year") assert.equal(v.quarters.reduce((a, s) => a + s.days, 0), v.total);
    }
  }
  const goal = computeView({ view: "goal", cal: "hijri", tz: "UTC", start: fromISO("2020-01-01"), end: fromISO("2020-03-01") });
  assert.equal(goal.elapsed, goal.total);
  assert.equal(goal.footer, "Done");
  assert.throws(() => computeView({ view: "goal", cal: "hijri", tz: "UTC", start: fromISO("2026-03-01"), end: fromISO("2026-01-01") }));
});

test("sunset matches published times within 3 minutes", async () => {
  const { sunset } = await import("../site/lib/calendar.js");
  const cases = [
    // [civil date, lat, lon, expected sunset UTC "HH:MM"]
    ["2026-06-21", 51.5074, -0.1278, "20:21"], // London, midsummer (21:21 BST)
    ["2026-12-21", 51.5074, -0.1278, "15:54"], // London, midwinter
    ["2026-10-14", 34.05, -118.24, "01:20"], // Los Angeles 18:20 PDT = next day 01:20 UTC
  ];
  for (const [iso, lat, lon, hhmm] of cases) {
    const s = sunset(fromISO(iso), lat, lon);
    const [h, m] = hhmm.split(":").map(Number);
    let expected = fromISO(iso) + (h * 60 + m) * 60000;
    if (lon < -60 && h < 12) expected += DAY;
    assert.ok(Math.abs(s - expected) < 3 * 60000, `${iso} ${lat},${lon}: ${new Date(s).toISOString()}`);
  }
  assert.equal(sunset(fromISO("2026-06-21"), 69.65, 18.96), null); // midnight sun
});

test("Hijri date advances at sunset, Gregorian at midnight", async () => {
  const { effectiveToday } = await import("../site/lib/calendar.js");
  const riyadh = { tz: "Asia/Riyadh", lat: 24.7, lon: 46.7 }; // sunset ~17:40 local in October
  const before = new Date("2026-10-14T14:00:00Z"); // 17:00 local
  const after = new Date("2026-10-14T15:30:00Z"); // 18:30 local
  const civil = fromISO("2026-10-14");
  assert.equal(effectiveToday({ cal: "hijri", ...riyadh, now: before }), civil);
  assert.equal(effectiveToday({ cal: "hijri", ...riyadh, now: after }), civil + DAY);
  assert.equal(effectiveToday({ cal: "hijri", ...riyadh, dayStart: "midnight", now: after }), civil);
  assert.equal(effectiveToday({ cal: "gregory", ...riyadh, now: after }), civil);
  assert.equal(effectiveToday({ cal: "hijri", tz: "Asia/Riyadh", now: after }), civil); // no location
});
