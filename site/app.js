import { WORKER_URL } from "./config.js";
import { computeView, fromISO, fromParts, monthLength, monthName, parts, sunsetPlace, toISO, today } from "./lib/calendar.js";
import { layout, THEMES, toSVG } from "./lib/render.js";

// Portrait screen sizes in physical pixels.
const DEVICES = [
  ["iPhone 18 Pro Max · 17 Pro Max · 16 Pro Max", 1320, 2868],
  ["iPhone 18 Pro · 17 · 17 Pro · 16 Pro", 1206, 2622],
  ["iPhone Duo — inner screen", 1878, 2670],
  ["iPhone Duo — outer screen", 1398, 2034],
  ["iPhone Air", 1260, 2736],
  ["iPhone 16 · 15 · 15 Pro · 14 Pro", 1179, 2556],
  ["iPhone 16 Plus · 15 Plus · 15 Pro Max · 14 Pro Max", 1290, 2796],
  ["iPhone 16e · 14 · 13 · 13 Pro · 12 · 12 Pro", 1170, 2532],
  ["iPhone 14 Plus · 13 Pro Max · 12 Pro Max", 1284, 2778],
  ["iPhone 13 mini · 12 mini", 1080, 2340],
  ["iPhone 11 · XR", 828, 1792],
  ["iPhone SE (2nd/3rd gen) · 8 · 7 · 6s", 750, 1334],
  ["Android 1080 × 2400", 1080, 2400],
  ["Android 1440 × 3120", 1440, 3120],
];
const STORE = "life-calendar:v1";

const form = document.getElementById("form");
const $ = (sel) => form.querySelector(sel);
const el = (tag, props = {}, children = []) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
};

// ---- state ---------------------------------------------------------------

const tzGuess = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

function nextRamadan(tz) {
  const p = parts("hijri", today(tz));
  return fromParts("hijri", p.m >= 9 ? p.y + 1 : p.y, 9, 1);
}

const saved = (() => {
  try {
    return JSON.parse(localStorage.getItem(STORE)) ?? {};
  } catch {
    return {};
  }
})();

const state = {
  view: "year",
  cal: "hijri",
  layout: "months",
  weekStart: 6, // Saturday, so the week ends on Friday
  dayStart: "sunset", // Hijri day begins at Maghrib
  lat: null, // optional, rounded; sunset location (else the time zone's city)
  lon: null,
  theme: "dark",
  accent: null, // null = theme default
  w: 1179,
  h: 2556,
  tz: tzGuess,
  top: 33,
  bottom: 14,
  title: "Ramadan",
  start: toISO(today(tzGuess)),
  end: null,
  ...saved,
};
state.end ??= toISO(nextRamadan(state.tz));

const save = () => localStorage.setItem(STORE, JSON.stringify(state));

// ---- form setup ----------------------------------------------------------

const deviceSel = $("#device");
for (const [name, w, h] of DEVICES) deviceSel.append(el("option", { value: `${w}x${h}`, textContent: `${name} — ${w}×${h}` }));
deviceSel.append(el("option", { value: "custom", textContent: "Custom size" }));

const tzList = document.getElementById("tz-list");
for (const tz of Intl.supportedValuesOf?.("timeZone") ?? []) tzList.append(el("option", { value: tz }));

function setRadio(name, value) {
  const r = form.querySelector(`input[name="${name}"][value="${value}"]`);
  if (r) r.checked = true;
}

function syncForm() {
  setRadio("view", state.view);
  setRadio("cal", state.cal);
  setRadio("theme", state.theme);
  setRadio("layout", effectiveLayout());
  $("[name=weekStart]").value = state.weekStart;
  $("#layout-fields").hidden = state.view === "goal";
  $("#layout-quarters").hidden = state.view !== "year";
  $("#week-start").hidden = effectiveLayout() === "grid";
  $("[name=w]").value = state.w;
  $("[name=h]").value = state.h;
  $("[name=tz]").value = state.tz;
  $("[name=title]").value = state.title;
  $("[name=top]").value = state.top;
  $("[name=bottom]").value = state.bottom;
  $("[name=accent]").value = state.accent ?? THEMES[state.theme].today;
  const preset = `${state.w}x${state.h}`;
  deviceSel.value = DEVICES.some(([, w, h]) => `${w}x${h}` === preset) ? preset : "custom";
  for (const r of form.querySelectorAll("input[type=range]")) r.nextElementSibling.textContent = `${r.value}%`;
  $("#goal-fields").hidden = state.view !== "goal";
  $("#day-start").hidden = state.cal !== "hijri";
  $("[name=dayStart]").value = state.dayStart;
  $("#location").hidden = state.dayStart !== "sunset";
  const hasLoc = state.lat != null && state.lon != null;
  const city = sunsetPlace({ tz: state.tz })?.city;
  $("#location-text").textContent = hasLoc
    ? `Sunset location: your location (${state.lat}, ${state.lon}).`
    : city
      ? `Sunset location: ${city}, your time zone's city. Your town's sunset may differ by several minutes.`
      : `Sunset location: none — ${state.tz} has no city, so the day changes at midnight until you use your location.`;
  $("#clear-location").textContent = city ? `Use ${city} instead` : "Forget";
  $("#use-location").hidden = hasLoc;
  $("#clear-location").hidden = !hasLoc;
  buildDateInputs();
  updateSetup();
}

// Setup instructions follow the moment the wallpaper changes.
function updateSetup() {
  const sunsetMode = state.cal === "hijri" && state.dayStart === "sunset";
  const ios = document.getElementById("ios-trigger");
  const android = document.getElementById("android-trigger");
  const b = (text) => el("b", { textContent: text });
  if (sunsetMode) {
    ios.replaceChildren(
      "Open ", b("Shortcuts"), " \u2192 ", b("Automation"), " \u2192 ", b("+"), " \u2192 ", b("Time of Day"),
      " and choose ", b("Sunset"), " with a small delay after it if offered (e.g. 15 minutes after), ",
      b("Daily"), ", ", b("Run Immediately"),
      ". The Hijri date changes at Maghrib, so the wallpaper does too \u2014 running it a few minutes after sunset avoids catching the old day.",
    );
    android.replaceChildren(
      "In an automation app (Tasker, MacroDroid or a \u201cwallpaper from URL\u201d app), create a task that runs ",
      b("shortly after sunset"), " every day and downloads the URL.",
    );
  } else {
    ios.replaceChildren(
      "Open ", b("Shortcuts"), " \u2192 ", b("Automation"), " \u2192 ", b("+"), " \u2192 ", b("Time of Day"),
      ". Pick a time just after midnight, ", b("Daily"), ", and ", b("Run Immediately"), ".",
    );
    android.replaceChildren(
      "In an automation app (Tasker, MacroDroid or a \u201cwallpaper from URL\u201d app), create a task that runs ",
      b("just after midnight"), " every day and downloads the URL.",
    );
  }
}

// Date pickers follow the chosen calendar: native <input type=date> for
// Gregorian, day / month / year selects for Hijri. Values are stored as ISO.
function buildDateInputs() {
  for (const box of form.querySelectorAll("[data-date]")) {
    const key = box.dataset.date;
    const t = fromISO(state[key]) ?? today(state.tz);
    box.replaceChildren();
    if (state.cal === "gregory") {
      const input = el("input", { type: "date", value: toISO(t), required: true });
      input.addEventListener("change", () => {
        if (fromISO(input.value) != null) update({ [key]: input.value });
      });
      box.append(input);
      continue;
    }
    const p = parts("hijri", t);
    const day = el("select", {}, Array.from({ length: 30 }, (_, i) => el("option", { value: i + 1, textContent: i + 1 })));
    const month = el("select", {}, Array.from({ length: 12 }, (_, i) => el("option", { value: i + 1, textContent: monthName("hijri", i + 1) })));
    const year = el("input", { type: "number", min: 1356, max: 1500, value: p.y, className: "year" });
    day.value = p.d;
    month.value = p.m;
    const onChange = () => {
      const y = Number(year.value);
      const m = Number(month.value);
      let d = Number(day.value);
      const len = monthLength("hijri", y, m);
      if (len == null) return;
      if (d > len) {
        d = len;
        day.value = d;
      }
      const civil = fromParts("hijri", y, m, d);
      if (civil != null) update({ [key]: toISO(civil) });
    };
    for (const c of [day, month, year]) c.addEventListener("change", onChange);
    box.append(day, month, year, el("span", { className: "suffix", textContent: "AH" }));
  }
}

// "quarters" only makes sense for the year view; the quarter view falls back to months.
function effectiveLayout() {
  if (state.view === "goal") return "grid";
  if (state.layout === "quarters" && state.view !== "year") return "months";
  return state.layout;
}

function update(patch, { rebuild = false } = {}) {
  Object.assign(state, patch);
  save();
  if (rebuild) syncForm();
  render();
}

form.addEventListener("change", (e) => {
  const { name, value } = e.target;
  if (!name) return;
  if (name === "view" || name === "cal") update({ [name]: value }, { rebuild: true });
  else if (name === "theme") update({ theme: value }, { rebuild: true });
  else if (name === "layout") update({ layout: value }, { rebuild: true });
  else if (name === "weekStart") update({ weekStart: Number(value) });
  else if (name === "dayStart") update({ dayStart: value }, { rebuild: true });
  else if (name === "accent") update({ accent: value.toLowerCase() === THEMES[state.theme].today ? null : value });
  else if (name === "device") {
    if (value !== "custom") {
      const [w, h] = value.split("x").map(Number);
      update({ w, h }, { rebuild: true });
    }
  } else if (name === "w" || name === "h") {
    const v = Number(value);
    if (Number.isInteger(v) && v >= 200 && v <= 4000) update({ [name]: v }, { rebuild: true });
  } else if (name === "tz") {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value });
      // A different zone means a different place: sunset follows its city.
      if (value !== state.tz) update({ tz: value, lat: null, lon: null }, { rebuild: true });
    } catch {
      e.target.value = state.tz;
    }
  }
});

form.addEventListener("input", (e) => {
  const { name, value } = e.target;
  if (name === "top" || name === "bottom") {
    e.target.nextElementSibling.textContent = `${value}%`;
    update({ [name]: Number(value) });
  } else if (name === "title") update({ title: value });
});

document.getElementById("use-location").addEventListener("click", (e) => {
  if (!navigator.geolocation) {
    e.target.textContent = "Location not available";
    return;
  }
  e.target.textContent = "Locating\u2026";
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => {
      e.target.textContent = "Use my precise location";
      // ~10 km precision: plenty for sunset (under a minute), and less identifying
      update({ lat: Math.round(coords.latitude * 10) / 10, lon: Math.round(coords.longitude * 10) / 10 }, { rebuild: true });
    },
    () => {
      e.target.textContent = "Couldn't get location \u2014 try again";
    },
    { maximumAge: 3_600_000, timeout: 15_000 },
  );
});

document.getElementById("clear-location").addEventListener("click", () => update({ lat: null, lon: null }, { rebuild: true }));

document.getElementById("this-screen").addEventListener("click", () => {
  const dpr = window.devicePixelRatio || 1;
  const a = Math.round(screen.width * dpr);
  const b = Math.round(screen.height * dpr);
  update({ w: Math.min(a, b), h: Math.max(a, b) }, { rebuild: true });
});

// ---- output --------------------------------------------------------------

function wallpaperURL() {
  const q = new URLSearchParams({ view: state.view, cal: state.cal, w: state.w, h: state.h, tz: state.tz, theme: state.theme });
  const lay = effectiveLayout();
  if (lay !== "grid") {
    q.set("layout", lay);
    q.set("ws", state.weekStart);
  }
  if (state.cal === "hijri") {
    if (state.dayStart === "midnight") q.set("day", "midnight");
    else if (state.lat != null && state.lon != null) {
      q.set("lat", state.lat);
      q.set("lon", state.lon);
    }
  }
  if (state.accent) q.set("accent", state.accent.replace("#", ""));
  if (state.top !== 33) q.set("top", state.top);
  if (state.bottom !== 14) q.set("bottom", state.bottom);
  if (state.view === "goal") {
    q.set("start", state.start);
    q.set("end", state.end);
    if (state.title) q.set("title", state.title);
  }
  return `${WORKER_URL}/wallpaper.png?${q}`;
}

const preview = document.getElementById("preview");
const urlBox = document.getElementById("url");
const openLink = document.getElementById("open");
const goalError = document.getElementById("goal-error");

function render() {
  let v;
  try {
    v = computeView({
      view: state.view,
      cal: state.cal,
      tz: state.tz,
      start: fromISO(state.start),
      end: fromISO(state.end),
      title: state.title,
      lat: state.lat,
      lon: state.lon,
      dayStart: state.dayStart,
    });
    goalError.hidden = true;
  } catch (e) {
    goalError.textContent = e.message.replace(/^goal needs end date after start$/, "The target date must be after the start date.");
    goalError.hidden = false;
    urlBox.value = "";
    openLink.removeAttribute("href");
    return;
  }
  const L = layout({
    ...state,
    ...v,
    layout: effectiveLayout(),
    accent: state.accent ?? undefined,
    top: state.top / 100,
    bottom: state.bottom / 100,
  });
  const doc = new DOMParser().parseFromString(toSVG(L), "image/svg+xml");
  preview.replaceChildren(document.importNode(doc.documentElement, true));
  const url = wallpaperURL();
  urlBox.value = url;
  openLink.href = url;
}

document.getElementById("copy").addEventListener("click", async (e) => {
  try {
    await navigator.clipboard.writeText(urlBox.value);
    e.target.textContent = "Copied";
  } catch {
    urlBox.select();
    e.target.textContent = "Press ⌘C";
  }
  setTimeout(() => {
    e.target.textContent = "Copy";
  }, 1500);
});

syncForm();
render();
