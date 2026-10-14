// Cloudflare Worker: renders wallpaper PNGs on request.
//   GET /wallpaper.png?view=year|quarter|goal&cal=hijri|gregory&w=1179&h=2556&tz=Asia/Riyadh
//                     &theme=dark|black|light&accent=d9a441
//                     &layout=grid|months|quarters&ws=0..6   (block layouts; ws 0 = Sunday)
//                     [&start=YYYY-MM-DD&end=YYYY-MM-DD&title=...]   (goal)
//   GET /wallpaper.svg?...   same, as SVG (debugging)

import { initWasm } from "@resvg/resvg-wasm";
import resvgWasm from "@resvg/resvg-wasm/index_bg.wasm";
import interRegular from "../site/fonts/Inter-Regular.ttf";
import interSemiBold from "../site/fonts/Inter-SemiBold.ttf";
import { computeView, fromISO, today, toISO } from "../site/lib/calendar.js";
import { LAYOUTS, layout, THEMES, toSVG } from "../site/lib/render.js";
import { rasterize } from "./raster.js";

let ready;
const fonts = [new Uint8Array(interRegular), new Uint8Array(interSemiBold)];

const CORS = { "Access-Control-Allow-Origin": "*" };

class BadRequest extends Error {}

function int(params, key, def, min, max) {
  const raw = params.get(key);
  if (raw == null || raw === "") return def;
  const v = Number(raw);
  if (!Number.isInteger(v) || v < min || v > max) throw new BadRequest(`${key} must be an integer in ${min}..${max}`);
  return v;
}

function oneOf(params, key, allowed, def) {
  const v = params.get(key) ?? def;
  if (!allowed.includes(v)) throw new BadRequest(`${key} must be one of: ${allowed.join(", ")}`);
  return v;
}

function validTimeZone(tz) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function parseParams(params) {
  const view = oneOf(params, "view", ["year", "quarter", "goal"], "year");
  const cal = oneOf(params, "cal", ["hijri", "gregory"], "hijri");
  const theme = oneOf(params, "theme", Object.keys(THEMES), "dark");
  const tz = params.get("tz") || "UTC";
  if (!validTimeZone(tz)) throw new BadRequest("tz must be an IANA time zone, e.g. Asia/Riyadh");
  const accent = params.get("accent") || undefined;
  if (accent && !/^#?[0-9a-f]{6}$/i.test(accent)) throw new BadRequest("accent must be a hex colour like d9a441");
  const out = {
    view,
    cal,
    theme,
    tz,
    accent,
    layout: oneOf(params, "layout", LAYOUTS, "grid"),
    weekStart: int(params, "ws", 0, 0, 6),
    w: int(params, "w", 1179, 200, 4000),
    h: int(params, "h", 2556, 200, 4000),
    top: int(params, "top", 33, 0, 80) / 100,
    bottom: int(params, "bottom", 14, 0, 80) / 100,
  };
  if (view === "goal") {
    out.start = params.get("start") ? fromISO(params.get("start")) : null;
    out.end = fromISO(params.get("end"));
    if (out.end == null) throw new BadRequest("goal needs end=YYYY-MM-DD");
    if (params.get("start") && out.start == null) throw new BadRequest("start must be YYYY-MM-DD");
    out.title = (params.get("title") || "").slice(0, 40);
  }
  return out;
}

function render(p, format) {
  let v;
  try {
    v = computeView(p);
  } catch (e) {
    throw new BadRequest(e.message);
  }
  const L = layout({ ...p, ...v });
  return format === "svg" ? toSVG(L) : rasterize(L, fonts);
}

export default {
  async fetch(request, env, ctx) {
    let url;
    try {
      url = new URL(request.url);
    } catch {
      return new Response("bad url", { status: 400 });
    }
    if (request.method === "OPTIONS") return new Response(null, { headers: { ...CORS, "Access-Control-Allow-Methods": "GET" } });
    if (request.method !== "GET") return new Response("method not allowed", { status: 405 });

    const format = { "/wallpaper.png": "png", "/wallpaper.svg": "svg" }[url.pathname];
    if (!format) {
      if (url.pathname === "/" && env.SITE_URL) return Response.redirect(env.SITE_URL, 302);
      return new Response("not found", { status: 404 });
    }

    let p;
    try {
      p = parseParams(url.searchParams);
    } catch (e) {
      if (e instanceof BadRequest) return new Response(e.message, { status: 400, headers: CORS });
      throw e;
    }

    // Images change once per day in the user's time zone: cache per (params, local date).
    const cacheKey = new Request(`${url.origin}${url.pathname}?${url.searchParams}&_d=${toISO(today(p.tz))}`);
    const cache = caches.default;
    const hit = await cache.match(cacheKey);
    if (hit) return hit;

    try {
      if (format === "png") {
        ready ??= initWasm(resvgWasm);
        await ready;
      }
      const body = render(p, format);
      const res = new Response(body, {
        headers: {
          ...CORS,
          "Content-Type": format === "png" ? "image/png" : "image/svg+xml",
          // short client cache; the edge copy is keyed by date so it's always correct
          "Cache-Control": "public, max-age=600",
        },
      });
      ctx.waitUntil(cache.put(cacheKey, res.clone()));
      return res;
    } catch (e) {
      if (e instanceof BadRequest) return new Response(e.message, { status: 400, headers: CORS });
      return new Response(`render failed: ${e.message}`, { status: 500, headers: CORS });
    }
  },
};
