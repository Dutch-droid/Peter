/* Progressive enhancement only: every page still works without this file. */
(function () {
  "use strict";
  document.documentElement.classList.add("js");
  const $ = (s, r) => (r || document).querySelector(s), $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const nf = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const compact = (v) => { const a = Math.abs(v); return a >= 1e9 ? +(v / 1e9).toFixed(1) + "B" : a >= 1e6 ? +(v / 1e6).toFixed(1) + "M" : a >= 1e3 ? +(v / 1e3).toFixed(1) + "K" : String(v); };

  /* theme + mobile nav */
  const root = document.documentElement;
  const tbtn = $("#theme");
  if (tbtn) tbtn.addEventListener("click", () => {
    const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    root.dataset.theme = dark ? "light" : "dark";
    try { localStorage.setItem("theme", root.dataset.theme); } catch (e) {}
    $$(".chart").forEach(drawChart);
  });
  const menu = $("#menu");
  if (menu) menu.addEventListener("click", () => document.body.classList.toggle("nav-open"));
  document.addEventListener("click", (e) => { if (document.body.classList.contains("nav-open") && !e.target.closest(".side,#menu")) document.body.classList.remove("nav-open"); });
  document.addEventListener("keydown", (e) => { if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { const s = $("#q"); if (s) { e.preventDefault(); s.focus(); } } });

  /* toasts (server flash is rendered inline first, so no-JS users still see it) */
  const box = $("#flash");
  if (box) {
    const t = document.createElement("div");
    t.className = "toast" + (box.dataset.kind === "err" ? " err" : ""); t.setAttribute("role", box.dataset.kind === "err" ? "alert" : "status");
    const m = document.createElement("div"); m.textContent = box.textContent.trim();
    const x = document.createElement("button"); x.type = "button"; x.className = "ghost"; x.setAttribute("aria-label", "Dismiss"); x.textContent = "×";
    t.append(m, x); $("#toasts").append(t); box.remove();
    const kill = () => t.remove(); x.onclick = kill; if (box.dataset.kind !== "err") setTimeout(kill, 6000);
  }

  /* tables: sort + filter */
  $$("table.sortable").forEach((tb) => {
    const body = tb.tBodies[0]; if (!body) return;
    $$("th", tb).forEach((th, i) => {
      if (th.dataset.nosort !== undefined || !th.textContent.trim()) return;
      th.dataset.sort = ""; th.tabIndex = 0;
      const go = () => {
        const asc = th.getAttribute("aria-sort") !== "ascending";
        $$("th", tb).forEach((o) => o.removeAttribute("aria-sort")); th.setAttribute("aria-sort", asc ? "ascending" : "descending");
        const val = (tr) => { const c = tr.cells[i]; return c ? (c.dataset.v ?? c.textContent.trim()) : ""; };
        const num = (s) => { const n = parseFloat(String(s).replace(/,/g, "")); return isNaN(n) ? null : n; };
        const rows = $$("tr", body).filter((r) => !r.classList.contains("total") && r.cells.length > 1);
        rows.sort((a, b) => { const x = val(a), y = val(b), nx = num(x), ny = num(y); const c = nx !== null && ny !== null ? nx - ny : x.localeCompare(y, undefined, { numeric: true }); return asc ? c : -c; });
        rows.forEach((r) => body.append(r));
      };
      th.addEventListener("click", go); th.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
    });
  });
  $$("input[data-filter]").forEach((inp) => {
    const tb = $(inp.dataset.filter), count = inp.parentElement.querySelector(".count");
    const run = () => { const q = inp.value.toLowerCase(); let n = 0; $$("tbody tr", tb).forEach((r) => { if (r.classList.contains("total") || r.cells.length < 2) return; const hit = r.textContent.toLowerCase().includes(q); r.hidden = !hit; if (hit) n++; }); if (count) count.textContent = n + " shown"; };
    inp.addEventListener("input", run); run();
  });

  /* tabs */
  $$("[data-tabs]").forEach((g) => {
    const tabs = $$("[role=tab]", g), panels = tabs.map((t) => $("#" + t.getAttribute("aria-controls")));
    const pick = (i) => tabs.forEach((t, j) => { t.setAttribute("aria-selected", i === j); panels[j].hidden = i !== j; });
    tabs.forEach((t, i) => t.addEventListener("click", () => pick(i))); pick(0);
  });

  /* dialogs, confirms, double-submit guard */
  $$("[data-dialog]").forEach((b) => b.addEventListener("click", () => { const d = $("#" + b.dataset.dialog); if (d && d.showModal) { d.showModal(); const f = $("input:not([type=hidden]),select", d); if (f) f.focus(); } }));
  $$("dialog [data-close]").forEach((b) => b.addEventListener("click", () => b.closest("dialog").close()));
  $$("dialog").forEach((d) => d.addEventListener("click", (e) => { if (e.target === d) d.close(); }));
  $$("form").forEach((f) => f.addEventListener("submit", (e) => {
    if (f.dataset.confirm && !confirm(f.dataset.confirm)) { e.preventDefault(); return; }
    $$("input[data-money]", f).forEach((i) => (i.value = i.value.replace(/,/g, "")));
    $$("button:not([type=button])", f).forEach((b) => setTimeout(() => (b.disabled = true), 0));
  }));
  window.addEventListener("pageshow", () => $$("form button:disabled").forEach((b) => (b.disabled = false)));

  /* money inputs: show thousands separators */
  $$("input[data-money]").forEach((i) => {
    i.addEventListener("blur", () => { const n = parseFloat(i.value.replace(/,/g, "")); if (!isNaN(n)) i.value = nf.format(n); });
    i.addEventListener("focus", () => (i.value = i.value.replace(/,/g, "")));
  });

  /* redemption estimate (same simple-interest rule as the server; the server figure is authoritative) */
  const rd = $("#redeem-date");
  if (rd) {
    const terms = JSON.parse(rd.dataset.terms), basis = +rd.dataset.basis || 365, out = $("#redeem-preview");
    const D = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 864e5;
    const calc = () => { if (!rd.value) return; const end = D(rd.value); let tot = 0;
      terms.forEach((t) => { const e = Math.min(D(t.maturity), end), s = D(t.start); if (e > s) tot += t.principal * t.rate / 100 / basis * (e - s); });
      out.textContent = "Estimated interest earned if redeemed on " + rd.value + ": " + nf.format(tot) + ". Accrual stops on that date."; };
    rd.addEventListener("input", calc); calc();
  }

  /* charts: one bar form for ladder / exposure / monthly interest. Hover + keyboard tooltip; table view lives beside it. */
  const NS = "http://www.w3.org/2000/svg";
  const el = (n, a, p) => { const e = document.createElementNS(NS, n); for (const k in a || {}) e.setAttribute(k, a[k]); if (p) p.append(e); return e; };
  function drawChart(host) {
    const cfg = JSON.parse(host.dataset.chart), labels = cfg.labels, vals = cfg.values, horiz = cfg.horizontal;
    host.textContent = "";
    if (!vals.length || Math.max(...vals) <= 0) { const p = document.createElement("p"); p.className = "muted"; p.textContent = "No data to chart yet."; host.append(p); return; }
    const W = Math.max(host.clientWidth, 280), max = Math.max(...vals);
    const ticks = niceTicks(max, 4), top = ticks[ticks.length - 1];
    const tip = document.createElement("div"); tip.className = "tip"; host.append(tip);
    const show = (i, x, y) => { tip.textContent = ""; const b = document.createElement("b"), s = document.createElement("span"); b.textContent = nf.format(vals[i]); s.textContent = labels[i] + (cfg.unit ? " · " + cfg.unit : ""); tip.append(b, s); tip.classList.add("on"); const w = tip.offsetWidth; tip.style.left = Math.max(0, Math.min(W - w, x - w / 2)) + "px"; tip.style.top = Math.max(0, y - tip.offsetHeight - 8) + "px"; };
    const hide = () => tip.classList.remove("on");
    let svg;
    if (!horiz) {
      const H = 230, m = { l: 46, r: 8, t: 14, b: 26 }, pw = W - m.l - m.r, ph = H - m.t - m.b, slot = pw / vals.length, bw = Math.min(24, slot * 0.7);
      svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": cfg.title + ". " + labels.map((l, i) => l + " " + nf.format(vals[i])).join("; ") }, host);
      ticks.forEach((t) => { const y = m.t + ph - (t / top) * ph; el("line", { class: t === 0 ? "axis" : "grid", x1: m.l, x2: W - m.r, y1: y, y2: y }, svg); const tx = el("text", { x: m.l - 6, y: y + 4, "text-anchor": "end" }, svg); tx.textContent = compact(t); });
      const every = Math.ceil(54 / slot), hi = vals.indexOf(max);
      vals.forEach((v, i) => {
        const cx = m.l + slot * i + slot / 2, h = (v / top) * ph, y = m.t + ph - h, g = el("g", { class: "hit", tabindex: 0, "aria-label": labels[i] + " " + nf.format(v) }, svg);
        el("rect", { x: m.l + slot * i, y: m.t, width: slot, height: ph, fill: "transparent" }, g);
        if (h > 0) { const r = Math.min(4, h), x = cx - bw / 2; el("path", { class: "bar", d: `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + bw - r}Q${x + bw},${y} ${x + bw},${y + r}V${y + h}Z` }, g); }
        if (i % every === 0) { const t = el("text", { class: "cat", x: cx, y: H - 8, "text-anchor": "middle" }, svg); t.textContent = labels[i]; }
        if (i === hi && v > 0) { const t = el("text", { class: "val", x: cx, y: y - 5, "text-anchor": "middle" }, svg); t.textContent = compact(v); }
        const at = () => show(i, cx, y); g.addEventListener("pointerenter", at); g.addEventListener("pointermove", at); g.addEventListener("pointerleave", hide); g.addEventListener("focus", at); g.addEventListener("blur", hide);
      });
    } else {
      const rowH = 34, H = vals.length * rowH + 8, m = { l: Math.min(170, W * 0.38), r: 84, t: 4 }, pw = W - m.l - m.r;
      svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": cfg.title + ". " + labels.map((l, i) => l + " " + nf.format(vals[i])).join("; ") }, host);
      el("line", { class: "axis", x1: m.l, x2: m.l, y1: m.t, y2: H - 4 }, svg);
      vals.forEach((v, i) => {
        const y = m.t + i * rowH + (rowH - 22) / 2, w = (v / top) * pw, g = el("g", { class: "hit", tabindex: 0, "aria-label": labels[i] + " " + nf.format(v) }, svg);
        el("rect", { x: 0, y: m.t + i * rowH, width: W, height: rowH, fill: "transparent" }, g);
        const t = el("text", { class: "cat", x: m.l - 8, y: y + 15, "text-anchor": "end" }, svg); t.textContent = labels[i].length > 24 ? labels[i].slice(0, 23) + "…" : labels[i];
        if (w > 0) { const r = Math.min(4, w); el("path", { class: "bar", d: `M${m.l},${y}H${m.l + w - r}Q${m.l + w},${y} ${m.l + w},${y + r}V${y + 22 - r}Q${m.l + w},${y + 22} ${m.l + w - r},${y + 22}H${m.l}Z` }, g); }
        const vt = el("text", { class: "val", x: m.l + w + 6, y: y + 15 }, svg); vt.textContent = compact(v);
        const at = () => show(i, m.l + w / 2, y + 22 + 6 + 26); g.addEventListener("pointerenter", at); g.addEventListener("pointermove", at); g.addEventListener("pointerleave", hide); g.addEventListener("focus", at); g.addEventListener("blur", hide);
      });
    }
  }
  function niceTicks(max, n) { const raw = max / n, p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p, step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p, out = []; for (let v = 0; v <= max + step * 0.999; v += step) out.push(+v.toFixed(6)); return out.length < 2 ? [0, step] : out; }
  $$(".chart").forEach(drawChart);
  let rt; addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => $$(".chart").forEach(drawChart), 120); });
})();
