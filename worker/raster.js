// Fast PNG rasterizer for the wallpaper layout.
// Rendering the whole SVG with resvg + its PNG encoder costs ~45ms CPU, which
// is over the Cloudflare Workers free-plan budget. Instead we:
//   - draw anti-aliased dots directly into an 8-bit palette buffer,
//   - render only the text strips with resvg,
//   - compress with a run-length deflate that skips empty rows (deflate.js).

import { Resvg } from "@resvg/resvg-wasm";
import { FONT_FAMILY, textSVG } from "../site/lib/render.js";
import { zlibRLE } from "./deflate.js";

const LEVELS = 15; // anti-aliasing levels per colour

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

function buildPalette(bg, colors) {
  const b = rgb(bg);
  const pal = [b];
  for (const c of colors) {
    const f = rgb(c);
    for (let l = 1; l <= LEVELS; l++) {
      const a = l / LEVELS;
      pal.push(f.map((v, i) => Math.round(b[i] + (v - b[i]) * a)));
    }
  }
  return pal;
}

const colorIndex = (ci, level) => 1 + ci * LEVELS + (level - 1);

/** @param {ReturnType<import("../site/lib/render.js").layout>} L */
export function rasterize(L, fontBuffers) {
  const { w, h, r } = L;
  const used = new Set([...L.dots.map((d) => d.fill), ...L.texts.map((t) => t.fill)]);
  const colors = [...used].filter((c) => c !== L.bg);
  const ci = new Map(colors.map((c, i) => [c, i]));
  const palette = buildPalette(L.bg, colors);

  const stride = w + 1; // leading filter byte (0 = None) per row
  const raw = new Uint8Array(stride * h); // zero-filled = background
  const rowUsed = new Uint8Array(h);
  const markRows = (y0, y1) => rowUsed.fill(1, Math.max(0, y0), Math.min(h, y1 + 1));

  // Dots: per-pixel coverage from distance to centre.
  for (const d of L.dots) {
    const c = ci.get(d.fill);
    if (c === undefined) continue;
    const x0 = Math.max(0, Math.floor(d.cx - r - 1));
    const x1 = Math.min(w - 1, Math.ceil(d.cx + r + 1));
    const y0 = Math.max(0, Math.floor(d.cy - r - 1));
    const y1 = Math.min(h - 1, Math.ceil(d.cy + r + 1));
    markRows(y0, y1);
    for (let y = y0; y <= y1; y++) {
      const dy = y + 0.5 - d.cy;
      const row = y * stride + 1;
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - d.cx;
        const cov = r + 0.5 - Math.sqrt(dx * dx + dy * dy);
        if (cov <= 0) continue;
        const level = cov >= 1 ? LEVELS : Math.round(cov * LEVELS);
        if (level > 0) raw[row + x] = colorIndex(c, level);
      }
    }
  }

  // Text: render all strips stacked into one small SVG, then copy alpha back.
  if (L.texts.length) {
    const strips = [];
    let stackH = 0;
    let stackW = 1;
    for (const t of L.texts) {
      const top = Math.max(0, Math.floor(t.y - t.size * 1.1));
      const height = Math.min(h - top, Math.ceil(t.size * 1.5));
      const left = t.box ? Math.max(0, Math.floor(t.box[0])) : 0;
      const width = (t.box ? Math.min(w, Math.ceil(t.box[1])) : w) - left;
      strips.push({ t, top, height, left, width, at: stackH });
      stackH += height;
      stackW = Math.max(stackW, width);
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${stackW}" height="${stackH}" font-family="${FONT_FAMILY}">${strips
      .map((s) => textSVG(s.t, s.at - s.top, -s.left))
      .join("")}</svg>`;
    const img = new Resvg(svg, {
      font: { fontBuffers, defaultFontFamily: FONT_FAMILY, loadSystemFonts: false },
    }).render();
    const px = img.pixels;
    for (const s of strips) {
      const c = ci.get(s.t.fill);
      markRows(s.top, s.top + s.height - 1);
      for (let y = 0; y < s.height; y++) {
        const src = (s.at + y) * stackW * 4;
        const dst = (s.top + y) * stride + 1 + s.left;
        for (let x = 0; x < s.width; x++) {
          const a = px[src + x * 4 + 3];
          if (a) {
            const level = Math.round((a / 255) * LEVELS);
            if (level > 0) raw[dst + x] = colorIndex(c, level);
          }
        }
      }
    }
    img.free?.();
  }

  return encodePNG(w, h, palette, zlibRLE(raw, stride, rowUsed));
}

// ---- PNG encoding -------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function encodePNG(w, h, palette, idat) {
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 3; // colour type: indexed
  const plte = new Uint8Array(palette.length * 3);
  for (let i = 0; i < palette.length; i++) plte.set(palette[i], i * 3);

  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("PLTE", plte),
    chunk("IDAT", idat),
    chunk("IEND", new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
