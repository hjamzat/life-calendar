// Layout + SVG output shared by the site preview and the worker.
// The worker rasterizes the same layout directly (see worker/raster.js).

export const THEMES = {
  dark: { bg: "#0e0f10", past: "#e9e6df", future: "#2a2b2d", today: "#d9a441", text: "#e9e6df", muted: "#7d7f82" },
  black: { bg: "#000000", past: "#e9e6df", future: "#1f2021", today: "#d9a441", text: "#e9e6df", muted: "#6f7174" },
  light: { bg: "#f4f1ea", past: "#24221f", future: "#d9d4c9", today: "#b5832a", text: "#24221f", muted: "#8a857c" },
};

export const FONT_FAMILY = "Inter";

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

/**
 * Compute positions for everything on the wallpaper.
 * @param {object} o
 * @param {number} o.w, o.h        canvas size in px
 * @param {number} o.total         number of dots
 * @param {number} o.elapsed       index of today's dot (dots before it are past)
 * @param {string} o.title, o.subtitle, o.footer
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
  const maxGridW = w * 0.78;
  const maxGridH = Math.max(10, bottom - top - headerH - gap - footerH);

  const { cols, rows, cell: rawCell } = fitGrid(total, maxGridW, maxGridH);
  const cell = Math.min(rawCell, w / 8);
  const gridW = cols * cell;
  const gridH = rows * cell;
  const blockH = headerH + gap + gridH + footerH;
  const y0 = top + Math.max(0, (bottom - top - blockH) / 2);
  const x0 = (w - gridW) / 2;
  const gy = y0 + headerH + gap;
  const r = cell * 0.34;

  const dots = [];
  for (let i = 0; i < total; i++) {
    let fill = th.future;
    if (i < elapsed) fill = th.past;
    else if (i === elapsed) fill = th.today;
    dots.push({
      cx: x0 + (i % cols) * cell + cell / 2,
      cy: gy + Math.floor(i / cols) * cell + cell / 2,
      fill,
    });
  }

  const left = x0 + cell / 2 - r;
  const right = x0 + gridW - cell / 2 + r;
  const texts = [
    { text: o.title ?? "", x: left, y: y0 + titleSize, size: titleSize, weight: 600, fill: th.text, anchor: "start" },
    { text: o.subtitle ?? "", x: left, y: y0 + titleSize + subSize * 1.6, size: subSize, weight: 400, fill: th.muted, anchor: "start" },
    { text: o.footer ?? "", x: right, y: gy + gridH + footSize * 1.9, size: footSize, weight: 600, fill: th.today, anchor: "end" },
  ].filter((t) => t.text);

  return { w, h, bg: th.bg, r, dots, texts };
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const n = (x) => x.toFixed(1);

export function textSVG(t, dy = 0) {
  return `<text x="${n(t.x)}" y="${n(t.y + dy)}" font-size="${n(t.size)}" font-weight="${t.weight}" fill="${t.fill}" text-anchor="${t.anchor}">${esc(t.text)}</text>`;
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
