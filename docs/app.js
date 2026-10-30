"use strict";

// ---------- helpers ----------
const $ = (sel) => document.querySelector(sel);
const SVG_NS = "http://www.w3.org/2000/svg";

function svgEl(tag, attrs = {}, parent) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  if (parent) parent.appendChild(node);
  return node;
}

function htmlEl(tag, attrs = {}, parent) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "text") node.textContent = value;
    else if (key === "html") node.innerHTML = value;
    else node.setAttribute(key, value);
  }
  if (parent) parent.appendChild(node);
  return node;
}

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmt = (v, digits = 2) => Number(v).toFixed(digits);
const signed = (v, digits = 2) => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(digits);
const pct = (v, digits = 0) => `${(v * 100).toFixed(digits)}%`;

function hexToRgb(hex) {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(a, b, t) {
  const [ra, ga, ba] = hexToRgb(a);
  const [rb, gb, bb] = hexToRgb(b);
  const c = (x, y) => Math.round(x + (y - x) * t);
  return `rgb(${c(ra, rb)}, ${c(ga, gb)}, ${c(ba, bb)})`;
}
function rampColor(stops, t) {
  t = Math.max(0, Math.min(1, t));
  const scaled = t * (stops.length - 1);
  const i = Math.min(Math.floor(scaled), stops.length - 2);
  return mix(stops[i], stops[i + 1], scaled - i);
}
function diverging(value, limit) {
  const stops = ["--div-neg-2", "--div-neg-1", "--div-mid", "--div-pos-1", "--div-pos-2"].map(css);
  return rampColor(stops, (value / limit + 1) / 2);
}
function sequential(value, max) {
  return rampColor([css("--seq-0"), css("--seq-1")], value / max);
}
function inkFor(rgb) {
  const [r, g, b] = rgb.match(/\d+/g).map(Number);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.55 ? "#0b0b0b" : "#ffffff";
}

// ---------- tooltip ----------
const tooltip = $("#tooltip");
function showTooltip(event, title, rows = []) {
  tooltip.innerHTML = `<div class="tt-title">${escapeHtml(title)}</div>` +
    rows.map(([k, v]) => `<div class="tt-row"><span>${escapeHtml(k)}</span><b>${escapeHtml(v)}</b></div>`).join("");
  tooltip.hidden = false;
  const pad = 14;
  const { innerWidth: w, innerHeight: h } = window;
  const box = tooltip.getBoundingClientRect();
  let x = event.clientX + pad;
  let y = event.clientY + pad;
  if (x + box.width > w - 8) x = event.clientX - box.width - pad;
  if (y + box.height > h - 8) y = event.clientY - box.height - pad;
  tooltip.style.left = `${Math.max(8, x)}px`;
  tooltip.style.top = `${Math.max(8, y)}px`;
}
const hideTooltip = () => { tooltip.hidden = true; };
window.addEventListener("scroll", hideTooltip, { passive: true });

function segmented(container, onChange) {
  container.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    for (const b of container.querySelectorAll("button")) b.setAttribute("aria-checked", String(b === button));
    onChange(button.dataset.value);
  });
}

function tile(parent, value, label, cls = "") {
  const t = htmlEl("div", { class: `tile ${cls}` }, parent);
  htmlEl("div", { class: "value", text: value }, t);
  htmlEl("div", { class: "label", text: label }, t);
}

// ---------- state ----------
let DATA;
const state = {
  cell: { group: "Attackers", metric: "xg" },
  team: "all",
  player: "all",
  outcome: "all",
  territory: "diff",
};

const METRIC_SECTIONS = [
  ["Shooting", ["xg", "shots", "touches_in_box"]],
  ["Creating", ["xa", "chances_created", "passes_into_box", "crosses"]],
  ["Passing & progression", ["passes", "pass_completion_pct", "ground_pass_pct", "long_balls", "switches",
    "passes_into_final_third", "progressive_passes", "progressive_carries"]],
  ["On the ball", ["actions_under_pressure", "successful_dribbles", "turnovers"]],
  ["Defending", ["tackles", "tackles_won", "interceptions", "pressures", "blocks", "clearances",
    "middle_third_recoveries", "fouls_committed"]],
];
const RATE_METRICS = new Set(["pass_completion_pct", "ground_pass_pct"]);
const HEAT_LIMIT = 0.25;
const unit = (metric) => (RATE_METRICS.has(metric) ? "%" : " per 90");

// ---------- hero ----------
function renderSummary() {
  const s = DATA.summary;
  const root = $("#summary-tiles");
  root.innerHTML = "";
  tile(root, s.matches, "matches");
  tile(root, s.events.toLocaleString(), "events");
  tile(root, s.player_matches.toLocaleString(), "player performances");
  tile(root, s.shots.toLocaleString(), "shots");
  tile(root, s.goals, "goals (excl. own goals)");
}

// ---------- correlation heatmap ----------
function corrFor(group, metric) {
  return DATA.correlations.find((c) => c.position_group === group && c.metric === metric);
}

function renderHeatmap() {
  const root = $("#heatmap");
  root.innerHTML = "";
  htmlEl("div", {}, root);
  for (const group of DATA.groups) htmlEl("div", { class: "col-head", text: group }, root);

  for (const [section, metrics] of METRIC_SECTIONS) {
    htmlEl("div", { class: "group-head", text: section }, root);
    for (const metric of metrics) {
      htmlEl("div", { class: "row-head", text: DATA.labels[metric] }, root);
      for (const group of DATA.groups) {
        const c = corrFor(group, metric);
        const bg = diverging(c.rho, HEAT_LIMIT);
        const selected = state.cell.group === group && state.cell.metric === metric;
        const button = htmlEl("button", {
          style: `background:${bg};color:${inkFor(bg)}`,
          class: selected ? "selected" : "",
          "aria-pressed": String(selected),
          "aria-label": `${DATA.labels[metric]}, ${group}: rho ${signed(c.rho)}${c.significant ? ", significant" : ", not significant"}`,
          text: c.significant ? signed(c.rho) : "",
        }, root);
        button.addEventListener("click", () => { state.cell = { group, metric }; renderHeatmap(); renderDistribution(); });
        button.addEventListener("pointermove", (e) => showTooltip(e, `${DATA.labels[metric]} · ${group}`, [
          ["Spearman ρ", signed(c.rho, 3)],
          ["FDR-adjusted p", c.p_adjusted < 0.001 ? "< 0.001" : fmt(c.p_adjusted, 3)],
          ["Player-matches", c.n],
          ["Significant", c.significant ? "Yes" : "No"],
        ]));
        button.addEventListener("pointerleave", hideTooltip);
      }
    }
  }

  const legend = $("#heatmap-legend");
  legend.innerHTML = "";
  htmlEl("span", { text: "Goes with losing" }, legend);
  const stops = [-1, -0.5, 0, 0.5, 1].map((t) => diverging(t * HEAT_LIMIT, HEAT_LIMIT));
  htmlEl("span", { class: "bar", style: `background:linear-gradient(90deg,${stops.join(",")})` }, legend);
  htmlEl("span", { text: "Goes with winning" }, legend);
  htmlEl("span", { text: `(scale ±${HEAT_LIMIT})` }, legend);
}

function renderCorrTable() {
  const rows = METRIC_SECTIONS.flatMap(([, metrics]) => metrics).map((metric) => {
    const cells = DATA.groups.map((g) => {
      const c = corrFor(g, metric);
      return `<td class="n">${signed(c.rho)}${c.significant ? " *" : ""}</td>`;
    }).join("");
    return `<tr><td>${escapeHtml(DATA.labels[metric])}</td>${cells}</tr>`;
  }).join("");
  $("#corr-table").innerHTML = `<table><thead><tr><th>Stat</th>${DATA.groups.map((g) => `<th class="n">${g}</th>`).join("")}</tr></thead>
    <tbody>${rows}</tbody></table><p class="meta">* significant after Benjamini–Hochberg correction (q &lt; 0.05).</p>`;
}

function renderDistribution() {
  const { group, metric } = state.cell;
  const c = corrFor(group, metric);
  const dist = DATA.distributions[group][metric];
  $("#dist-title").textContent = `${DATA.labels[metric]}${RATE_METRICS.has(metric) ? "" : " per 90"} · ${group}`;
  $("#dist-meta").textContent = `ρ = ${signed(c.rho, 3)} · FDR-adjusted p ${c.p_adjusted < 0.001 ? "< 0.001" : "= " + fmt(c.p_adjusted, 3)} · ` +
    `${c.significant ? "significant" : "not significant"} · n = ${c.n}`;

  const svg = $("#dist-chart");
  svg.innerHTML = "";
  const width = Math.max(260, svg.clientWidth || svg.parentNode.clientWidth - 36);
  const rows = [["win", "Win", css("--pos")], ["draw", "Draw", css("--neutral")], ["loss", "Loss", css("--neg")]];
  const left = 48, right = 78, top = 8, rowH = 46, axisH = 28;
  const height = top + rows.length * rowH + axisH;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("aria-label", `Distribution of ${DATA.labels[metric]} for ${group} by match result`);

  const max = Math.max(...rows.map(([k]) => dist[k][4])) || 1;
  const x = (v) => left + (v / max) * (width - left - right);
  const ticks = niceTicks(0, max, 4);
  const grid = svgEl("g", { class: "grid" }, svg);
  for (const t of ticks) {
    svgEl("line", { x1: x(t), x2: x(t), y1: top, y2: top + rows.length * rowH }, grid);
    svgEl("text", { x: x(t), y: height - 8, "text-anchor": "middle" }, svg).textContent = formatTick(t);
  }

  rows.forEach(([key, label, color], i) => {
    const [p10, p25, p50, p75, p90] = dist[key];
    const cy = top + i * rowH + rowH / 2;
    const g = svgEl("g", {}, svg);
    svgEl("text", { x: 0, y: cy + 4, style: `fill:${css("--ink")};font-weight:600` }, g).textContent = label;
    svgEl("line", { x1: x(p10), x2: x(p90), y1: cy, y2: cy, stroke: color, "stroke-width": 2 }, g);
    svgEl("rect", { x: x(p25), y: cy - 11, width: Math.max(2, x(p75) - x(p25)), height: 22, rx: 4,
      fill: color, "fill-opacity": 0.35, stroke: color, "stroke-width": 1.5 }, g);
    svgEl("line", { x1: x(p50), x2: x(p50), y1: cy - 13, y2: cy + 13, stroke: css("--ink"), "stroke-width": 2.5 }, g);
    svgEl("text", { x: x(p90) + 8, y: cy + 4, style: `fill:${css("--ink")}` }, g).textContent = `med ${formatTick(p50)}`;
    const hit = svgEl("rect", { x: left, y: cy - rowH / 2, width: width - left, height: rowH, fill: "transparent" }, g);
    hit.addEventListener("pointermove", (e) => showTooltip(e, `${label} · ${DATA.labels[metric]}`, [
      ["90th percentile", formatTick(p90)], ["75th", formatTick(p75)], ["Median", formatTick(p50)],
      ["25th", formatTick(p25)], ["10th", formatTick(p10)],
    ]));
    hit.addEventListener("pointerleave", hideTooltip);
  });

  const win = dist.win[2], loss = dist.loss[2];
  const ratio = loss > 0 ? ` (${fmt(win / loss, 1)}×)` : "";
  $("#dist-note").textContent = `Median for players on winning teams: ${formatTick(win)}${unit(metric)}; on losing teams: ` +
    `${formatTick(loss)}${unit(metric)}${win > loss ? ratio : ""}. Box = middle 50% of players, whiskers = 10th–90th percentile.`;
}

function niceTicks(min, max, count) {
  const span = max - min || 1;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) || mag * 10;
  const ticks = [];
  for (let t = Math.ceil(min / step) * step; t <= max + 1e-9; t += step) ticks.push(+t.toFixed(10));
  return ticks;
}
const formatTick = (v) => (Math.abs(v) >= 10 ? fmt(v, 0) : Math.abs(v) >= 1 ? fmt(v, 1) : fmt(v, 2));

// ---------- shot map ----------
const shotR = (xg) => Math.max(0.45, Math.sqrt(xg) * 3.3);

function drawHalfPitch(svg) {
  const line = { fill: "none", stroke: css("--pitch-line"), "stroke-width": 0.3 };
  const g = svgEl("g", { "pointer-events": "none" }, svg);
  svgEl("rect", { x: 0, y: 0, width: 80, height: 60, ...line }, g);
  svgEl("rect", { x: 18, y: 0, width: 44, height: 18, ...line }, g);
  svgEl("rect", { x: 30, y: 0, width: 20, height: 6, ...line }, g);
  svgEl("rect", { x: 36, y: -2, width: 8, height: 2, ...line }, g);
  svgEl("circle", { cx: 40, cy: 12, r: 0.4, fill: css("--pitch-line") }, g);
  svgEl("path", { d: "M32,18 A10,10 0 0,0 48,18", ...line }, g);
  svgEl("path", { d: "M30,60 A10,10 0 0,1 50,60", ...line }, g);
}

function filteredShots() {
  return DATA.shots.filter((s) =>
    (state.team === "all" || s.team === state.team) &&
    (state.player === "all" || s.player === state.player) &&
    (state.outcome === "all" || (state.outcome === "goal" ? s.goal : s.on_target)));
}

function populateShotFilters() {
  const teamSelect = $("#team-filter");
  const teams = [...new Set(DATA.shots.map((s) => s.team))].sort();
  teamSelect.innerHTML = `<option value="all">All teams</option>` +
    teams.map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("");
  teamSelect.value = state.team;
  populatePlayerFilter();
}

function populatePlayerFilter() {
  const playerSelect = $("#player-filter");
  const pool = DATA.shots.filter((s) => state.team === "all" || s.team === state.team);
  const players = [...new Set(pool.map((s) => s.player))].sort((a, b) => a.localeCompare(b));
  playerSelect.innerHTML = `<option value="all">All players</option>` +
    players.map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join("");
  if (!players.includes(state.player)) state.player = "all";
  playerSelect.value = state.player;
}

function renderShotMap() {
  const svg = $("#shot-map");
  svg.innerHTML = "";
  svg.setAttribute("viewBox", "-1.5 -3 83 64.5");
  drawHalfPitch(svg);

  const shots = filteredShots();
  const ordered = [...shots].sort((a, b) => (a.goal - b.goal) || (b.xg - a.xg));
  const dots = svgEl("g", {}, svg);
  const surface = css("--surface");
  for (const s of ordered) {
    svgEl("circle", {
      cx: s.y, cy: 120 - s.x, r: shotR(s.xg),
      fill: s.goal ? css("--pos") : css("--neutral"),
      "fill-opacity": s.goal ? 0.95 : 0.75,
      stroke: surface, "stroke-width": 0.18,
    }, dots);
  }
  const ring = svgEl("circle", { fill: "none", stroke: css("--ink"), "stroke-width": 0.35, visibility: "hidden" }, svg);

  svg.onpointermove = (event) => {
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(svg.getScreenCTM().inverse());
    let best = null, bestDist = Infinity;
    for (const s of shots) {
      const d = Math.hypot(s.y - point.x, 120 - s.x - point.y) - shotR(s.xg);
      if (d < bestDist) { bestDist = d; best = s; }
    }
    if (!best || bestDist > 1.2) { ring.setAttribute("visibility", "hidden"); hideTooltip(); return; }
    ring.setAttribute("cx", best.y);
    ring.setAttribute("cy", 120 - best.x);
    ring.setAttribute("r", shotR(best.xg) + 0.5);
    ring.setAttribute("visibility", "visible");
    showTooltip(event, `${best.player} (${best.team})`, [
      ["Match", best.match], ["Minute", `${best.minute}'`], ["xG", fmt(best.xg, 2)],
      ["Outcome", best.outcome], ["Type", `${best.shot_type}, ${best.body_part}`],
    ]);
  };
  svg.onpointerleave = () => { ring.setAttribute("visibility", "hidden"); hideTooltip(); };

  const legend = $("#shot-legend");
  legend.innerHTML = `<span><span class="swatch" style="background:${css("--pos")}"></span>Goal</span>` +
    `<span><span class="swatch" style="background:${css("--neutral")}"></span>No goal</span>` +
    `<span>Bigger marker = higher xG (a penalty is 0.78)</span>`;

  const tiles = $("#shot-tiles");
  tiles.innerHTML = "";
  const goals = shots.filter((s) => s.goal).length;
  const xg = shots.reduce((sum, s) => sum + s.xg, 0);
  tile(tiles, shots.length.toLocaleString(), "shots");
  tile(tiles, goals, "goals");
  tile(tiles, fmt(xg, 1), "expected goals (xG)");
  tile(tiles, signed(goals - xg, 1), "goals minus xG", goals - xg > 0 ? "highlight" : "");

  renderLeaderboard();
}

function renderLeaderboard() {
  const pool = DATA.shots.filter((s) => state.team === "all" || s.team === state.team);
  const byPlayer = new Map();
  for (const s of pool) {
    const p = byPlayer.get(s.player) || { player: s.player, team: s.team, shots: 0, goals: 0, xg: 0 };
    p.shots += 1; p.goals += s.goal ? 1 : 0; p.xg += s.xg;
    byPlayer.set(s.player, p);
  }
  const top = [...byPlayer.values()].sort((a, b) => b.goals - a.goals || b.xg - a.xg).slice(0, 8);
  $("#leaderboard-title").textContent = state.team === "all" ? "Top scorers" : `Top scorers · ${state.team}`;
  const table = $("#leaderboard");
  table.innerHTML = `<thead><tr><th>Player</th><th class="n hide-sm">Shots</th><th class="n">Goals</th><th class="n">xG</th><th class="n">G − xG</th></tr></thead>`;
  const body = htmlEl("tbody", {}, table);
  for (const p of top) {
    const diff = p.goals - p.xg;
    const row = htmlEl("tr", {}, body);
    const cell = htmlEl("td", {}, row);
    const button = htmlEl("button", { class: "link", text: p.player }, cell);
    if (state.team === "all") htmlEl("span", { class: "sub", text: p.team }, cell);
    button.addEventListener("click", () => {
      state.team = p.team; state.player = p.player;
      populateShotFilters(); renderShotMap();
    });
    htmlEl("td", { class: "n hide-sm", text: p.shots }, row);
    htmlEl("td", { class: "n", text: p.goals }, row);
    htmlEl("td", { class: "n", text: fmt(p.xg, 1) }, row);
    htmlEl("td", { class: `n ${diff >= 0 ? "delta-pos" : "delta-neg"}`, text: signed(diff, 1) }, row);
  }
}

// ---------- territory ----------
function renderTerritory() {
  const svg = $("#territory-map");
  svg.innerHTML = "";
  svg.setAttribute("viewBox", "-2 -9 124 91");
  const { win, lose } = DATA.touch_grid;
  const rows = win.length, cols = win[0].length;
  const zw = 120 / cols, zh = 80 / rows;
  const diff = win.map((row, r) => row.map((v, c) => v - lose[r][c]));
  const diffLimit = Math.max(...diff.flat().map(Math.abs));
  const seqMax = Math.max(...win.flat(), ...lose.flat());

  const zones = svgEl("g", {}, svg);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const value = state.territory === "diff" ? diff[r][c] : (state.territory === "win" ? win : lose)[r][c];
      const fill = state.territory === "diff" ? diverging(value, diffLimit) : sequential(value, seqMax);
      const rect = svgEl("rect", { x: c * zw + 0.4, y: r * zh + 0.4, width: zw - 0.8, height: zh - 0.8, rx: 0.8, fill }, zones);
      svgEl("text", { x: c * zw + zw / 2, y: r * zh + zh / 2 + 1.2, "text-anchor": "middle",
        style: `fill:${inkFor(fill)};font-size:2.8px;font-weight:600;pointer-events:none` }, zones)
        .textContent = state.territory === "diff" ? signed(value, 2) : `${fmt(value, 1)}%`;
      rect.addEventListener("pointermove", (e) => showTooltip(e, "Pitch zone", [
        ["Winners' share", `${fmt(win[r][c], 2)}%`], ["Losers' share", `${fmt(lose[r][c], 2)}%`],
        ["Difference", `${signed(diff[r][c], 2)} pts`],
      ]));
      rect.addEventListener("pointerleave", hideTooltip);
    }
  }

  const line = { fill: "none", stroke: css("--ink-2"), "stroke-width": 0.35, "stroke-opacity": 0.7 };
  const g = svgEl("g", { "pointer-events": "none" }, svg);
  svgEl("rect", { x: 0, y: 0, width: 120, height: 80, ...line }, g);
  svgEl("line", { x1: 60, x2: 60, y1: 0, y2: 80, ...line }, g);
  svgEl("circle", { cx: 60, cy: 40, r: 10, ...line }, g);
  for (const [x0, dir] of [[0, 1], [120, -1]]) {
    svgEl("rect", { x: dir > 0 ? 0 : 102, y: 18, width: 18, height: 44, ...line }, g);
    svgEl("rect", { x: dir > 0 ? 0 : 114, y: 30, width: 6, height: 20, ...line }, g);
    svgEl("rect", { x: dir > 0 ? -1.5 : 120, y: 36, width: 1.5, height: 8, ...line }, g);
  }
  svgEl("line", { x1: 48, x2: 71, y1: -4.5, y2: -4.5, stroke: css("--ink-3"), "stroke-width": 0.4 }, svg);
  svgEl("path", { d: "M70,-6 L72.5,-4.5 L70,-3 Z", fill: css("--ink-3") }, svg);
  svgEl("text", { x: 60, y: -6.5, "text-anchor": "middle", style: "font-size:2.8px" }, svg).textContent = "Attacking direction";

  const legend = $("#territory-legend");
  legend.innerHTML = "";
  if (state.territory === "diff") {
    htmlEl("span", { text: "Losers more" }, legend);
    const stops = [-1, -0.5, 0, 0.5, 1].map((t) => diverging(t * diffLimit, diffLimit));
    htmlEl("span", { class: "bar", style: `background:linear-gradient(90deg,${stops.join(",")})` }, legend);
    htmlEl("span", { text: `Winners more (±${fmt(diffLimit, 2)} percentage points)` }, legend);
  } else {
    htmlEl("span", { text: "0%" }, legend);
    htmlEl("span", { class: "bar", style: `background:linear-gradient(90deg,${css("--seq-0")},${css("--seq-1")})` }, legend);
    htmlEl("span", { text: `${fmt(seqMax, 1)}% of on-ball actions` }, legend);
  }

  const thirdStart = Math.round((cols * 2) / 3);
  const sumThird = (grid) => grid.reduce((t, row) => t + row.slice(thirdStart).reduce((a, b) => a + b, 0), 0);
  const ownHalf = (grid) => grid.reduce((t, row) => t + row.slice(0, cols / 2).reduce((a, b) => a + b, 0), 0);
  $("#territory-note").textContent = `Winners make ${fmt(sumThird(win), 1)}% of their on-ball actions in the final third, losers ` +
    `${fmt(sumThird(lose), 1)}%. Losers spend more of the ball in their own half (${fmt(ownHalf(lose), 1)}% vs ` +
    `${fmt(ownHalf(win), 1)}%), especially in central midfield.`;
}

// ---------- model ----------
function renderModel() {
  const { scores, coefficients, matches } = DATA.model;
  const tiles = $("#model-tiles");
  tiles.innerHTML = "";
  const byName = Object.fromEntries(scores.map((s) => [s.model, s]));
  tile(tiles, pct(byName["All 8 stat differences"].accuracy), "accuracy, all 8 stat differences", "highlight");
  tile(tiles, pct(byName["xG difference only"].accuracy), "accuracy, xG difference only");
  tile(tiles, pct(byName["Coin flip (50%)"].accuracy), "accuracy, coin flip");
  tile(tiles, matches.length, "decisive matches (draws excluded)");

  renderCoefficients(coefficients);
  renderMatchDots(matches);
  renderSurprises(matches);
}

function renderCoefficients(coefficients) {
  const svg = $("#coef-chart");
  svg.innerHTML = "";
  const coefs = [...coefficients].sort((a, b) => b.coefficient - a.coefficient);
  const width = Math.max(260, svg.clientWidth || svg.parentNode.clientWidth - 36);
  const rowH = 40, top = 4, axisH = 26;
  const height = top + coefs.length * rowH + axisH;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  const lo = Math.min(...coefs.map((c) => c.ci_low)), hi = Math.max(...coefs.map((c) => c.ci_high));
  const limit = Math.ceil(Math.max(Math.abs(lo), Math.abs(hi)) * 2) / 2;
  const x = (v) => 6 + ((v + limit) / (2 * limit)) * (width - 12);

  const grid = svgEl("g", { class: "grid" }, svg);
  for (const t of niceTicks(-limit, limit, 4)) {
    svgEl("line", { x1: x(t), x2: x(t), y1: top, y2: top + coefs.length * rowH, class: t === 0 ? "zero" : "" }, grid);
    svgEl("text", { x: x(t), y: height - 6, "text-anchor": "middle" }, svg).textContent = t === 0 ? "0" : signed(t, 1);
  }
  coefs.forEach((c, i) => {
    const y = top + i * rowH;
    const significant = c.ci_low > 0 || c.ci_high < 0;
    const color = significant ? (c.coefficient > 0 ? css("--pos") : css("--neg")) : css("--neutral");
    const g = svgEl("g", {}, svg);
    svgEl("text", { x: 6, y: y + 13, style: `fill:${css("--ink")}` }, g).textContent = c.label;
    svgEl("line", { x1: x(c.ci_low), x2: x(c.ci_high), y1: y + 27, y2: y + 27, stroke: color, "stroke-width": 2.5, "stroke-linecap": "round" }, g);
    svgEl("circle", { cx: x(c.coefficient), cy: y + 27, r: 5.5, fill: color, stroke: css("--surface"), "stroke-width": 2 }, g);
    const hit = svgEl("rect", { x: 0, y, width, height: rowH, fill: "transparent" }, g);
    hit.addEventListener("pointermove", (e) => showTooltip(e, c.label, [
      ["Coefficient", signed(c.coefficient, 2)], ["95% interval", `${signed(c.ci_low, 2)} to ${signed(c.ci_high, 2)}`],
      ["Odds multiplier per SD", `×${fmt(Math.exp(c.coefficient), 2)}`],
      ["Reading", significant ? (c.coefficient > 0 ? "Clearly helps" : "Clearly hurts") : "Not distinguishable from 0"],
    ]));
    hit.addEventListener("pointerleave", hideTooltip);
  });
}

function renderMatchDots(matches) {
  const svg = $("#match-chart");
  svg.innerHTML = "";
  const width = Math.max(260, svg.clientWidth || svg.parentNode.clientWidth - 36);
  const bins = 20;
  const binW = (width - 12) / bins;
  const r = Math.min(7, binW / 2 - 1);
  const stacks = Array.from({ length: bins }, () => []);
  for (const m of [...matches].sort((a, b) => a.p_win - b.p_win)) {
    stacks[Math.min(bins - 1, Math.floor(m.p_win * bins))].push(m);
  }
  const maxStack = Math.max(...stacks.map((s) => s.length));
  const plotH = maxStack * (2 * r + 2) + 8, axisH = 30;
  const height = plotH + axisH;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  const x = (p) => 6 + p * (width - 12);

  const grid = svgEl("g", { class: "grid" }, svg);
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    svgEl("line", { x1: x(t), x2: x(t), y1: 0, y2: plotH, class: t === 0.5 ? "zero" : "", "stroke-dasharray": t === 0.5 ? "4 3" : "" }, grid);
    svgEl("text", { x: x(t), y: height - 12, "text-anchor": t === 0 ? "start" : t === 1 ? "end" : "middle" }, svg).textContent = pct(t);
  }
  svgEl("text", { x: x(0.5), y: height, "text-anchor": "middle", style: "font-size:11px" }, svg)
    .textContent = "Model's probability that the actual winner wins";

  stacks.forEach((stack, b) => {
    stack.forEach((m, k) => {
      const cx = x((b + 0.5) / bins), cy = plotH - r - 2 - k * (2 * r + 2);
      const right = m.p_win >= 0.5;
      const dot = svgEl("circle", { cx, cy, r, fill: right ? css("--pos") : css("--neg"), stroke: css("--surface"), "stroke-width": 1.5 }, svg);
      const hit = svgEl("circle", { cx, cy, r: r + 3, fill: "transparent" }, svg);
      hit.addEventListener("pointermove", (e) => {
        dot.setAttribute("stroke", css("--ink"));
        showTooltip(e, m.match, [
          ["Stage", m.stage], ["P(winner) all stats", pct(m.p_win)], ["P(winner) xG only", pct(m.p_win_xg_only)],
          ["xG", `${fmt(m.xg, 2)} – ${fmt(m.xg_opp, 2)}`], [`${m.winner} share of passes`, `${fmt(m.pass_share, 0)}%`],
        ]);
      });
      hit.addEventListener("pointerleave", () => { dot.setAttribute("stroke", css("--surface")); hideTooltip(); });
    });
  });

  const correct = matches.filter((m) => m.p_win >= 0.5).length;
  $("#match-legend").innerHTML = `<span><span class="swatch" style="background:${css("--pos")}"></span>Called correctly (${correct})</span>` +
    `<span><span class="swatch" style="background:${css("--neg")}"></span>Got it wrong (${matches.length - correct})</span>`;
}

function renderSurprises(matches) {
  const table = $("#surprises");
  const top = [...matches].sort((a, b) => a.p_win - b.p_win).slice(0, 6);
  table.innerHTML = `<thead><tr><th>Match</th><th class="n">P(winner)</th><th class="n">xG</th><th class="n hide-sm">Winner's passes</th></tr></thead>`;
  const body = htmlEl("tbody", {}, table);
  for (const m of top) {
    const row = htmlEl("tr", {}, body);
    const cell = htmlEl("td", {}, row);
    htmlEl("span", { text: m.match }, cell);
    htmlEl("span", { class: "sub", text: `${m.stage} · ${m.winner} won` }, cell);
    htmlEl("td", { class: "n delta-neg", text: pct(m.p_win) }, row);
    htmlEl("td", { class: "n", text: `${fmt(m.xg, 2)}–${fmt(m.xg_opp, 2)}` }, row);
    htmlEl("td", { class: "n hide-sm", text: `${fmt(m.pass_share, 0)}%` }, row);
  }
}

// ---------- wiring ----------
function renderAll() {
  renderSummary();
  renderHeatmap();
  renderCorrTable();
  renderDistribution();
  renderShotMap();
  renderTerritory();
  renderModel();
}

function wireControls() {
  $("#team-filter").addEventListener("change", (e) => { state.team = e.target.value; populatePlayerFilter(); renderShotMap(); });
  $("#player-filter").addEventListener("change", (e) => { state.player = e.target.value; renderShotMap(); });
  segmented($("#outcome-filter"), (v) => { state.outcome = v; renderShotMap(); });
  segmented($("#territory-view"), (v) => { state.territory = v; renderTerritory(); });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", renderAll);
  let resizeTimer;
  let lastWidth = window.innerWidth;
  window.addEventListener("resize", () => {
    if (window.innerWidth === lastWidth) return;
    lastWidth = window.innerWidth;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { renderDistribution(); renderModel(); }, 150);
  });
}

fetch("data/site.json")
  .then((r) => r.json())
  .then((data) => {
    DATA = data;
    populateShotFilters();
    wireControls();
    renderAll();
  })
  .catch((err) => {
    document.querySelector("main").insertAdjacentHTML("afterbegin",
      `<p class="note">Couldn't load the data (${escapeHtml(err.message)}). If you opened this file directly, serve the folder instead: <code>python -m http.server -d docs</code>.</p>`);
  });
