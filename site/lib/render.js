// Layout + SVG output shared by the site preview and the worker.
// The worker rasterizes the same layout directly (see worker/raster.js).

export const THEMES = {
  dark: { bg: "#0e0f10", past: "#e9e6df", future: "#2a2b2d", today: "#d9a441", text: "#e9e6df", muted: "#7d7f82" },
  black: { bg: "#000000", past: "#e9e6df", future: "#1f2021", today: "#d9a441", text: "#e9e6df", muted: "#6f7174" },
  light: { bg: "#f4f1ea", past: "#24221f", future: "#d9d4c9", today: "#b5832a", text: "#24221f", muted: "#8a857c" },
};

export const FONT_FAMILY = "Inter";
export const LAYOUTS = ["grid", "months", "quarters"];

/** Pick the column count that gives the biggest square cell for `count` dots in a W×H box. */
export function fitGrid(count, W, H) {
  let best = { cols: 1, rows: count, cell: 0 };
  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols);
    const cell = Math.min(W / cols, H / rows);
    if (cell > best.cell) best = { cols, rows, cell };
  }
  return best;
}

export function themeColors(theme, accent) {
  const th = { ...(THEMES[theme] ?? THEMES.dark) };
  if (accent && /^#?[0-9a-f]{6}$/i.test(accent)) th.today = accent.startsWith("#") ? accent : `#${accent}`;
  return th;
}

// Body layouts return positions relative to their own top-left corner:
// { width, height, cell, dots: [{cx, cy}], labels: [{text, x, y, size, seg}] }

/** One continuous grid of `total` dots. */
function gridBody(total, W, H, maxCell) {
  const { cols, rows, cell: raw } = fitGrid(total, W, H);
  const cell = Math.min(raw, maxCell);
  const dots = [];
  for (let i = 0; i < total; i++) {
    dots.push({ cx: (i % cols) * cell + cell / 2, cy: Math.floor(i / cols) * cell + cell / 2 });
  }
  return { width: cols * cell, height: rows * cell, cell, dots, labels: [] };
}

// Block geometry in units of one dot cell.
const LABEL_H = 1.6; // label line above each block
const GAP_X = 1.2; // between block columns
const GAP_Y = 0.9; // between block rows

/**
 * Calendar blocks: one 7-column, weekday-aligned block per segment
 * (month or quarter), arranged in as many columns as gives the biggest dots.
 */
function blocksBody(segments, weekStart, W, H, maxCell) {
  const segs = segments.map((s) => {
    const offset = (new Date(s.start).getUTCDay() - weekStart + 7) % 7;
    return { ...s, offset, rows: Math.ceil((offset + s.days) / 7) };
  });
  const maxRows = Math.max(...segs.map((s) => s.rows));

  let best = { k: 1, cell: 0 };
  for (let k = 1; k <= segs.length; k++) {
    const br = Math.ceil(segs.length / k);
    const cell = Math.min(W / (7 * k + GAP_X * (k - 1)), H / (br * (LABEL_H + maxRows) + GAP_Y * (br - 1)));
    if (cell > best.cell) best = { k, cell };
  }
  const { k } = best;
  const cell = Math.min(best.cell, maxCell);
  const br = Math.ceil(segs.length / k);

  const dots = [];
  const labels = [];
  const lastRowCount = segs.length - (br - 1) * k;
  segs.forEach((s, j) => {
    // centre an incomplete last row of blocks
    const shift = Math.floor(j / k) === br - 1 ? ((k - lastRowCount) * (7 + GAP_X) * cell) / 2 : 0;
    const ox = (j % k) * (7 + GAP_X) * cell + shift;
    const oy = Math.floor(j / k) * (LABEL_H + maxRows + GAP_Y) * cell;
    labels.push({ text: s.label, x: ox + cell * 0.16, y: oy + cell * 1.05, size: cell * 0.62, seg: j });
    for (let d = 0; d < s.days; d++) {
      const p = s.offset + d;
      dots.push({ cx: ox + (p % 7) * cell + cell / 2, cy: oy + (LABEL_H + Math.floor(p / 7)) * cell + cell / 2, seg: j });
    }
  });
  return {
    width: (7 * k + GAP_X * (k - 1)) * cell,
    height: (br * (LABEL_H + maxRows) + GAP_Y * (br - 1)) * cell,
    cell,
    dots,
    labels,
  };
}

/**
 * Compute positions for everything on the wallpaper.
 * @param {object} o
 * @param {number} o.w, o.h        canvas size in px
 * @param {number} o.total         number of dots
 * @param {number} o.elapsed       index of today's dot (dots before it are past)
 * @param {string} o.title, o.subtitle, o.footer
 * @param {string} [o.layout]      "grid" | "months" | "quarters"
 * @param {Array}  [o.months], [o.quarters]  segments from computeView
 * @param {number} [o.weekStart]   0 = Sunday … 6 = Saturday (block layouts)
 * @param {string} [o.theme]       key of THEMES
 * @param {string} [o.accent]      hex override for today's dot / footer
 * @param {number} [o.top]         fraction of height reserved at top (lock-screen clock)
 * @param {number} [o.bottom]      fraction of height reserved at bottom
 */
export function layout(o) {
  const { w, h, total, elapsed } = o;
  const th = themeColors(o.theme, o.accent);

  const top = h * (o.top ?? 0.33);
  const bottom = h * (1 - (o.bottom ?? 0.14));
  const unit = Math.min(w, h * 0.5);
  const titleSize = unit * 0.052;
  const subSize = unit * 0.032;
  const footSize = unit * 0.034;
  const gap = unit * 0.02;

  const headerH = titleSize + subSize * 2.2;
  const footerH = footSize * 2.6;
  const maxW = w * 0.78;
  const maxH = Math.max(10, bottom - top - headerH - gap - footerH);

  let segments = null;
  if (o.layout === "months") segments = o.months;
  else if (o.layout === "quarters") segments = o.quarters;
  const body = segments?.length
    ? blocksBody(segments, o.weekStart ?? 0, maxW, maxH, w / 14)
    : gridBody(total, maxW, maxH, w / 8);

  const blockH = headerH + gap + body.height + footerH;
  const y0 = top + Math.max(0, (bottom - top - blockH) / 2);
  const x0 = (w - body.width) / 2;
  const gy = y0 + headerH + gap;
  const r = body.cell * (segments ? 0.32 : 0.34);

  // Segment that contains today, to highlight its label.
  let todaySeg = -1;
  const dots = body.dots.map((d, i) => {
    let fill = th.future;
    if (i < elapsed) fill = th.past;
    else if (i === elapsed) {
      fill = th.today;
      todaySeg = d.seg ?? -1;
    }
    return { cx: x0 + d.cx, cy: gy + d.cy, fill };
  });

  const left = x0 + body.cell / 2 - r;
  const right = x0 + body.width - body.cell / 2 + r;
  const texts = [
    { text: o.title ?? "", x: left, y: y0 + titleSize, size: titleSize, weight: 600, fill: th.text, anchor: "start" },
    { text: o.subtitle ?? "", x: left, y: y0 + titleSize + subSize * 1.6, size: subSize, weight: 400, fill: th.muted, anchor: "start" },
    ...body.labels.map((l) => ({
      text: l.text,
      x: x0 + l.x,
      y: gy + l.y,
      size: l.size,
      weight: l.seg === todaySeg ? 600 : 400,
      fill: l.seg === todaySeg ? th.text : th.muted,
      anchor: "start",
      // horizontal extent, lets the rasterizer render a narrow strip
      box: [x0 + l.x - 2, x0 + l.x + body.cell * 7],
    })),
    { text: o.footer ?? "", x: right, y: gy + body.height + footSize * 1.9, size: footSize, weight: 600, fill: th.today, anchor: "end" },
  ].filter((t) => t.text);

  return { w, h, bg: th.bg, r, dots, texts };
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const n = (x) => x.toFixed(1);

export function textSVG(t, dy = 0, dx = 0) {
  return `<text x="${n(t.x + dx)}" y="${n(t.y + dy)}" font-size="${n(t.size)}" font-weight="${t.weight}" fill="${t.fill}" text-anchor="${t.anchor}">${esc(t.text)}</text>`;
}

export function toSVG(L) {
  const dots = L.dots.map((d) => `<circle cx="${n(d.cx)}" cy="${n(d.cy)}" r="${n(L.r)}" fill="${d.fill}"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${L.w}" height="${L.h}" viewBox="0 0 ${L.w} ${L.h}" font-family="${FONT_FAMILY}">
<rect width="${L.w}" height="${L.h}" fill="${L.bg}"/>
${L.texts.map((t) => textSVG(t)).join("\n")}
${dots.join("\n")}
</svg>`;
}

export function renderSVG(o) {
  return toSVG(layout(o));
}
