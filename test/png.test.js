import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { inflateSync } from "node:zlib";
import { initWasm } from "@resvg/resvg-wasm";
import { computeView } from "../site/lib/calendar.js";
import { layout } from "../site/lib/render.js";
import { zlibRLE } from "../worker/deflate.js";
import { rasterize } from "../worker/raster.js";

const root = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root));

test("zlibRLE output inflates back to the input", () => {
  const stride = 501;
  const rows = 300;
  const raw = new Uint8Array(stride * rows);
  const used = new Uint8Array(rows);
  for (let y = 0; y < rows; y++) {
    if (y % 3 === 0) continue;
    used[y] = 1;
    for (let x = 0; x < stride; x++) raw[y * stride + x] = (x * 7 + y) % 11 < 3 ? (x * y) % 256 : 0;
  }
  assert.deepEqual(new Uint8Array(inflateSync(zlibRLE(raw, stride, used))), raw);
});

test("rasterize produces a valid indexed PNG", async () => {
  await initWasm(read("node_modules/@resvg/resvg-wasm/index_bg.wasm"));
  const fonts = [read("site/fonts/Inter-Regular.ttf"), read("site/fonts/Inter-SemiBold.ttf")].map((b) => new Uint8Array(b));
  const v = computeView({ view: "year", cal: "hijri", tz: "UTC" });
  const png = rasterize(layout({ w: 600, h: 1300, ...v }), fonts);
  const dv = new DataView(png.buffer, png.byteOffset);
  assert.deepEqual([...png.subarray(1, 4)], [0x50, 0x4e, 0x47]); // "PNG"
  assert.equal(dv.getUint32(16), 600);
  assert.equal(dv.getUint32(20), 1300);
  assert.equal(png[25], 3); // indexed colour

  // Walk chunks and inflate IDAT: expect h rows of (w + 1) bytes, filter byte 0.
  let off = 8;
  let idat;
  while (off < png.length) {
    const len = dv.getUint32(off);
    const type = String.fromCharCode(...png.subarray(off + 4, off + 8));
    if (type === "IDAT") idat = png.subarray(off + 8, off + 8 + len);
    off += 12 + len;
  }
  const raw = inflateSync(idat);
  assert.equal(raw.length, 601 * 1300);
  for (let y = 0; y < 1300; y++) assert.equal(raw[y * 601], 0);
  assert.ok(raw.some((b) => b > 0), "has non-background pixels");
});
