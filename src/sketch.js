/*! @arterrible/sketch: Claude describes what to draw, Sketch lays it out and draws it. MIT licence. */
;(function (root) {
  const VERSION = "0.1.0"
  const ELK_URL = "https://cdn.jsdelivr.net/npm/elkjs@0.9.3/lib/elk.bundled.js"
  const ROUGH_URL = "https://cdn.jsdelivr.net/npm/roughjs@4.6.6/bundled/rough.js"
  const FONTS_URL = "https://fonts.googleapis.com/css2?family=Kalam:wght@400;700&family=Caveat:wght@600;700&display=swap"
  const NS = "http://www.w3.org/2000/svg"

  const SHAPES = ["box", "rounded", "diamond", "cylinder", "person", "note"]
  const TONES = ["accent", "muted", "store", "warn", "done"]

  // ---------- validation (pure, so it runs under node --test) ----------

  function validate(scene) {
    const errors = []
    if (!scene || typeof scene !== "object") return ["scene must be an object"]
    const nodes = Array.isArray(scene.nodes) ? scene.nodes : null
    if (!nodes || !nodes.length) errors.push("nodes: at least one node is needed")
    const groups = Array.isArray(scene.groups) ? scene.groups : []
    const edges = Array.isArray(scene.edges) ? scene.edges : []
    const ids = new Set()
    const add = (id, where) => {
      if (typeof id !== "string" || !id) errors.push(`${where}: id must be a non-empty string`)
      else if (ids.has(id)) errors.push(`${where}: duplicate id "${id}"`)
      else ids.add(id)
    }
    groups.forEach((g, i) => add(g && g.id, `groups[${i}]`))
    ;(nodes || []).forEach((n, i) => {
      add(n && n.id, `nodes[${i}]`)
      if (!n || typeof n.label !== "string" || !n.label.trim()) errors.push(`nodes[${i}]: label is required`)
      if (n && n.shape && !SHAPES.includes(n.shape)) errors.push(`nodes[${i}]: shape "${n.shape}" is not one of ${SHAPES.join(", ")}`)
      if (n && n.tone && !TONES.includes(n.tone)) errors.push(`nodes[${i}]: tone "${n.tone}" is not one of ${TONES.join(", ")}`)
    })
    const groupIds = new Set(groups.map((g) => g && g.id))
    groups.forEach((g, i) => { if (g && g.parent && !groupIds.has(g.parent)) errors.push(`groups[${i}]: parent "${g.parent}" is not a group`) })
    ;(nodes || []).forEach((n, i) => { if (n && n.group && !groupIds.has(n.group)) errors.push(`nodes[${i}]: group "${n.group}" is not a group`) })
    const nodeIds = new Set((nodes || []).map((n) => n && n.id))
    const edgeIds = new Set()
    edges.forEach((e, i) => {
      if (!e || !nodeIds.has(e.from)) errors.push(`edges[${i}]: from "${e && e.from}" is not a node`)
      if (!e || !nodeIds.has(e.to)) errors.push(`edges[${i}]: to "${e && e.to}" is not a node`)
      if (e) edgeIds.add(`${e.from}->${e.to}`)
    })
    ;(Array.isArray(scene.steps) ? scene.steps : []).forEach((s, i) => {
      for (const h of (s && s.highlight) || []) if (!ids.has(h) && !edgeIds.has(h)) errors.push(`steps[${i}]: highlight "${h}" is not a node, group or edge (edges are "from->to")`)
    })
    if (scene.direction && !["right", "down"].includes(scene.direction)) errors.push(`direction must be "right" or "down"`)
    return errors
  }

  // Layout input for ELK. Pure apart from the text measure, which is passed in.
  function elkGraph(scene, measure) {
    const groups = new Map((scene.groups || []).map((g) => [g.id, g]))
    const nodeById = new Map(scene.nodes.map((n) => [n.id, n]))
    const parentOf = (id) => {
      const n = nodeById.get(id)
      if (n) return n.group || "root"
      const g = groups.get(id)
      return (g && g.parent) || "root"
    }
    const chain = (id) => { const out = []; let p = parentOf(id); while (p !== "root") { out.push(p); p = parentOf(p) } out.push("root"); return out }
    const box = { root: { id: "root", children: [], edges: [], layoutOptions: {
      "elk.algorithm": "layered", "elk.direction": scene.direction === "down" ? "DOWN" : "RIGHT",
      "elk.edgeRouting": "ORTHOGONAL", "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.layered.spacing.nodeNodeBetweenLayers": "64", "elk.spacing.nodeNode": "36",
      "elk.layered.spacing.edgeNodeBetweenLayers": "22", "elk.spacing.edgeEdge": "16", "elk.spacing.edgeLabel": "4",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX", "elk.edgeLabels.inline": "true",
      // Respect the order the scene was written in: a back edge bends round instead of flipping the layers.
      "elk.layered.cycleBreaking.strategy": "MODEL_ORDER", "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      "elk.padding": "[top=16,left=16,bottom=16,right=16]" } } }
    for (const g of groups.values()) box[g.id] = { id: g.id, children: [], edges: [], layoutOptions: { "elk.padding": "[top=46,left=22,bottom=22,right=22]" } }
    for (const g of groups.values()) box[parentOf(g.id)].children.push(box[g.id])
    for (const n of scene.nodes) { const s = nodeSize(n, measure); box[parentOf(n.id)].children.push({ id: n.id, width: s.w, height: s.h }) }
    for (const e of scene.edges || []) {
      const a = chain(e.from), b = new Set(chain(e.to))
      const lca = a.find((p) => b.has(p)) || "root"
      const labels = e.label ? [{ text: e.label, width: Math.ceil(measure(e.label, "edge")) + 12, height: 20 }] : []
      box[lca].edges.push({ id: `${e.from}->${e.to}`, sources: [e.from], targets: [e.to], labels })
    }
    return box.root
  }

  function nodeSize(n, measure) {
    const lw = measure(n.label, "label"), sw = n.sub ? measure(n.sub, "sub") : 0
    const w = Math.max(116, Math.ceil(Math.max(lw, sw)) + 40)
    if (n.shape === "diamond") return { w: Math.max(130, Math.ceil(lw) + 80), h: 84 }
    if (n.shape === "person") return { w: Math.max(80, Math.ceil(lw) + 20), h: 96 }
    if (n.shape === "cylinder") return { w, h: n.sub ? 82 : 70 }
    return { w, h: n.sub ? 64 : 50 }
  }

  // Absolute boxes and edge offsets from ELK's nested result.
  function flatten(out) {
    const abs = {}, edges = {}
    const walk = (node, ox, oy) => {
      const x = ox + (node.x || 0), y = oy + (node.y || 0)
      abs[node.id] = { x, y, w: node.width, h: node.height }
      for (const c of node.children || []) walk(c, x, y)
      // Edge points are relative to the container they were defined in, which elkGraph makes the LCA.
      for (const e of node.edges || []) edges[e.id] = { sections: e.sections || [], labels: e.labels || [], ox: x, oy: y }
    }
    walk(out, 0, 0)
    return { abs, edges, width: out.width, height: out.height }
  }

  const seedOf = (s) => { let h = 7; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return (h % 2147483646) + 1 }

  const api = { VERSION, SHAPES, TONES, validate, elkGraph, nodeSize, flatten, seedOf }

  // ---------- browser ----------

  if (typeof document !== "undefined") {
    const loaded = new Map()
    const loadScript = (url, globalName) => {
      if (root[globalName]) return Promise.resolve()
      if (!loaded.has(url)) loaded.set(url, new Promise((resolve, reject) => {
        const s = document.createElement("script")
        s.src = url; s.async = true
        s.onload = () => resolve(); s.onerror = () => reject(new Error(`could not load ${url}`))
        document.head.appendChild(s)
      }))
      return loaded.get(url)
    }
    const loadFonts = () => {
      if (!document.querySelector("link[data-sketch-fonts]")) {
        const l = document.createElement("link"); l.rel = "stylesheet"; l.href = FONTS_URL; l.dataset.sketchFonts = ""
        document.head.appendChild(l)
      }
      if (!document.fonts) return Promise.resolve()
      const wait = Promise.all([document.fonts.load('700 17px Kalam'), document.fonts.load('600 24px Caveat')]).catch(() => {})
      return Promise.race([wait, new Promise((r) => setTimeout(r, 2500))])
    }

    const STYLE = `
.sk { --sk-paper:#fdfcf8; --sk-line:#ddd8cb; --sk-fg:#23211d; --sk-muted:#6b665c; --sk-ink:#2b2a27; --sk-accent:#2457c5; --sk-accent-fill:#e6eeff;
  --sk-store:#6b4fd8; --sk-store-fill:#f0ebff; --sk-warn:#b45309; --sk-warn-fill:#fff4e5; --sk-done:#047857; --sk-done-fill:#e9f7f0;
  --sk-group-fill:#f4f1e8; --sk-group-ink:#8d8677; --sk-muted-fill:#f2f1ed; --sk-pen:#d33a2c; --sk-edge:#4a4740;
  --sk-hand:"Kalam","Comic Sans MS",cursive; --sk-title:"Caveat","Kalam",cursive; --sk-sans:"IBM Plex Sans",system-ui,"Segoe UI",sans-serif;
  color:var(--sk-fg); font-family:var(--sk-sans); font-size:15px; line-height:1.5; display:flex; flex-direction:column; gap:8px; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .sk { --sk-paper:#1a1c20; --sk-line:#2c2f35; --sk-fg:#ece8df; --sk-muted:#a49e92; --sk-ink:#e9e5dc;
  --sk-accent:#8fb3ff; --sk-accent-fill:#1f2a40; --sk-store:#c1adff; --sk-store-fill:#2a2340; --sk-warn:#fbbf24; --sk-warn-fill:#3a2c12; --sk-done:#34d399; --sk-done-fill:#12302a;
  --sk-group-fill:#202227; --sk-group-ink:#8f897d; --sk-muted-fill:#1e2024; --sk-pen:#ff6b5a; --sk-edge:#c9c4b8; } }
:root[data-theme="dark"] .sk { --sk-paper:#1a1c20; --sk-line:#2c2f35; --sk-fg:#ece8df; --sk-muted:#a49e92; --sk-ink:#e9e5dc;
  --sk-accent:#8fb3ff; --sk-accent-fill:#1f2a40; --sk-store:#c1adff; --sk-store-fill:#2a2340; --sk-warn:#fbbf24; --sk-warn-fill:#3a2c12; --sk-done:#34d399; --sk-done-fill:#12302a;
  --sk-group-fill:#202227; --sk-group-ink:#8f897d; --sk-muted-fill:#1e2024; --sk-pen:#ff6b5a; --sk-edge:#c9c4b8; }
.sk-title { margin:0; font-family:var(--sk-title); font-size:30px; line-height:1.1; font-weight:700; }
.sk.sk-clean .sk-title { font-family:var(--sk-sans); font-size:20px; }
.sk-sub { color:var(--sk-muted); font-size:14px; margin:0; }
.sk-stage { position:relative; overflow-x:auto; }
.sk-stage svg { display:block; margin:0 auto; max-width:100%; height:auto; }
.sk-el { transition:opacity .25s ease; } .sk-el.sk-dim { opacity:.18; }
.sk-hit { cursor:help; } .sk-hit:focus { outline:none; }
.sk-tip { position:absolute; pointer-events:none; background:var(--sk-fg); color:var(--sk-paper); font-size:13px; line-height:1.4; padding:8px 10px; border-radius:8px; max-width:260px; z-index:5; }
.sk-steps { display:flex; flex-wrap:wrap; gap:10px 14px; align-items:center; border-top:1px dashed var(--sk-line); padding-top:10px; }
.sk-steps button { font:inherit; font-size:14px; background:transparent; color:var(--sk-fg); border:1.5px solid var(--sk-ink); border-radius:10px 12px 9px 11px; padding:8px 14px; min-height:40px; cursor:pointer; }
.sk-steps button:disabled { opacity:.35; cursor:default; }
.sk-steps button:focus-visible { outline:2px solid var(--sk-accent); outline-offset:2px; }
.sk-step { flex:1 1 260px; min-width:0; } .sk-step b { font-family:var(--sk-hand); font-size:18px; display:block; line-height:1.2; }
.sk.sk-clean .sk-step b { font-family:var(--sk-sans); font-size:15px; }
.sk-step span { color:var(--sk-muted); font-size:14px; } .sk-count { color:var(--sk-muted); font-size:14px; }
.sk-error { color:var(--sk-warn); font-size:14px; white-space:pre-wrap; }
@media (prefers-reduced-motion: reduce) { .sk-el { transition:none; } }`
    const ensureStyle = () => {
      if (document.getElementById("sketch-style")) return
      const s = document.createElement("style"); s.id = "sketch-style"; s.textContent = STYLE; document.head.appendChild(s)
    }

    const ctx = document.createElement("canvas").getContext("2d")

    function paint(scene, svg, L, wrap, onHover, clean) {
      svg.innerHTML = ""
      const v = (name) => getComputedStyle(wrap).getPropertyValue(name).trim()
      const F = clean
        ? { label: '600 15px "IBM Plex Sans", system-ui, sans-serif', sub: '400 12px "IBM Plex Sans", system-ui, sans-serif', edge: '400 12px "IBM Plex Sans", system-ui, sans-serif', group: '600 13px "IBM Plex Sans", system-ui, sans-serif' }
        : { label: '700 17px Kalam, "Comic Sans MS", cursive', sub: '400 13px Kalam, "Comic Sans MS", cursive', edge: '400 13px Kalam, "Comic Sans MS", cursive', group: '600 24px Caveat, Kalam, cursive' }
      const rough0 = clean ? 0 : 1
      const pad = 14
      svg.setAttribute("viewBox", `${-pad} ${-pad} ${L.width + pad * 2} ${L.height + pad * 2}`)
      svg.setAttribute("width", L.width + pad * 2)
      svg.setAttribute("role", "img")
      svg.setAttribute("aria-label", scene.title || "Diagram")
      const rc = root.rough.svg(svg)
      const ink = v("--sk-ink"), edgeInk = v("--sk-edge")
      const els = new Map()
      const groupIds = new Set((scene.groups || []).map((g) => g.id))
      const layer = (id) => { const g = document.createElementNS(NS, "g"); g.classList.add("sk-el"); g.dataset.id = id; svg.appendChild(g); els.set(id, g); return g }
      const text = (g, x, y, str, font, fill, anchor = "middle") => {
        const t = document.createElementNS(NS, "text")
        t.setAttribute("x", x); t.setAttribute("y", y); t.setAttribute("text-anchor", anchor); t.setAttribute("dominant-baseline", "middle")
        t.setAttribute("fill", fill); t.style.font = font; t.textContent = str; g.appendChild(t)
      }

      for (const gdef of scene.groups || []) {
        const b = L.abs[gdef.id]; if (!b) continue
        const g = layer(gdef.id)
        g.appendChild(rc.rectangle(b.x, b.y, b.w, b.h, { seed: seedOf(gdef.id), roughness: 1.1 * rough0, stroke: v("--sk-group-ink"), strokeWidth: 1.2, strokeLineDash: [7, 6], fill: v("--sk-group-fill"), fillStyle: "solid" }))
        text(g, b.x + 16, b.y + 22, gdef.label || "", F.group, v("--sk-group-ink"), "start")
      }

      for (const [id, e] of Object.entries(L.edges)) {
        const def = (scene.edges || []).find((x) => `${x.from}->${x.to}` === id)
        const g = layer(id)
        for (const s of e.sections) {
          const pts = [s.startPoint, ...(s.bendPoints || []), s.endPoint].map((p) => [p.x + e.ox, p.y + e.oy])
          const opts = { seed: seedOf(id), roughness: 0.9 * rough0, stroke: edgeInk, strokeWidth: 1.6, bowing: clean ? 0 : 1.2 }
          if (def && def.style === "dashed") opts.strokeLineDash = [6, 6]
          g.appendChild(rc.linearPath(pts, opts))
          const [x2, y2] = pts[pts.length - 1], [x1, y1] = pts[pts.length - 2]
          const ang = Math.atan2(y2 - y1, x2 - x1), len = 11, spread = 0.45
          g.appendChild(rc.polygon([[x2, y2], [x2 - len * Math.cos(ang - spread), y2 - len * Math.sin(ang - spread)], [x2 - len * Math.cos(ang + spread), y2 - len * Math.sin(ang + spread)]],
            { seed: seedOf(id + "h"), roughness: 0.6 * rough0, stroke: edgeInk, fill: edgeInk, fillStyle: "solid", strokeWidth: 1.2 }))
        }
        for (const lab of e.labels) {
          const x = lab.x + e.ox, y = lab.y + e.oy
          const bg = document.createElementNS(NS, "rect")
          bg.setAttribute("x", x); bg.setAttribute("y", y); bg.setAttribute("width", lab.width); bg.setAttribute("height", lab.height); bg.setAttribute("rx", 6)
          bg.setAttribute("fill", v("--sk-paper")); g.appendChild(bg)
          text(g, x + lab.width / 2, y + lab.height / 2 + 1, lab.text, F.edge, v("--sk-muted"))
        }
      }

      const toneColours = { accent: ["--sk-accent", "--sk-accent-fill"], store: ["--sk-store", "--sk-store-fill"], warn: ["--sk-warn", "--sk-warn-fill"], done: ["--sk-done", "--sk-done-fill"], muted: ["--sk-group-ink", "--sk-muted-fill"] }
      for (const n of scene.nodes) {
        const b = L.abs[n.id]; if (!b) continue
        const g = layer(n.id)
        const tone = n.tone || (n.shape === "cylinder" ? "store" : null)
        const [sv, fv] = toneColours[tone] || [null, null]
        const o = { seed: seedOf(n.id), roughness: 1.2 * rough0, stroke: sv ? v(sv) : ink, strokeWidth: tone === "accent" ? 2.2 : 1.6, fill: fv ? v(fv) : v("--sk-paper"), fillStyle: "solid" }
        const { x, y, w, h } = b, cx = x + w / 2
        let labelY = y + h / 2
        if (n.shape === "diamond") {
          g.appendChild(rc.polygon([[cx, y], [x + w, y + h / 2], [cx, y + h], [x, y + h / 2]], o))
        } else if (n.shape === "cylinder") {
          const ry = 9
          g.appendChild(rc.path(`M ${x} ${y + ry} L ${x} ${y + h - ry} A ${w / 2} ${ry} 0 0 0 ${x + w} ${y + h - ry} L ${x + w} ${y + ry}`, o))
          g.appendChild(rc.ellipse(cx, y + ry, w, ry * 2, { ...o, seed: o.seed + 1 }))
          labelY = y + h / 2 + 6
        } else if (n.shape === "person") {
          g.appendChild(rc.circle(cx, y + 16, 26, o))
          g.appendChild(rc.path(`M ${cx - 24} ${y + 64} Q ${cx - 22} ${y + 34} ${cx} ${y + 32} Q ${cx + 22} ${y + 34} ${cx + 24} ${y + 64} Z`, { ...o, seed: o.seed + 2 }))
          labelY = y + h - 12
        } else if (n.shape === "note") {
          const f = 14
          g.appendChild(rc.polygon([[x, y], [x + w - f, y], [x + w, y + f], [x + w, y + h], [x, y + h]], o))
          g.appendChild(rc.linearPath([[x + w - f, y], [x + w - f, y + f], [x + w, y + f]], { ...o, fill: undefined }))
        } else {
          const r = n.shape === "rounded" ? 20 : 6
          g.appendChild(rc.path(`M ${x + r} ${y} H ${x + w - r} Q ${x + w} ${y} ${x + w} ${y + r} V ${y + h - r} Q ${x + w} ${y + h} ${x + w - r} ${y + h} H ${x + r} Q ${x} ${y + h} ${x} ${y + h - r} V ${y + r} Q ${x} ${y} ${x + r} ${y} Z`, o))
        }
        if (n.sub && n.shape !== "person") {
          text(g, cx, labelY - 9, n.label, F.label, ink)
          text(g, cx, labelY + 12, n.sub, F.sub, v("--sk-muted"))
        } else text(g, cx, labelY, n.label, F.label, ink)
        if (n.description) {
          const hit = document.createElementNS(NS, "rect")
          hit.setAttribute("x", x); hit.setAttribute("y", y); hit.setAttribute("width", w); hit.setAttribute("height", h)
          hit.setAttribute("fill", "transparent"); hit.classList.add("sk-hit"); hit.setAttribute("tabindex", "0")
          hit.setAttribute("aria-label", `${n.label}: ${n.description}`)
          hit.addEventListener("pointerenter", (ev) => onHover(n, ev)); hit.addEventListener("pointermove", (ev) => onHover(n, ev))
          hit.addEventListener("pointerleave", () => onHover(null)); hit.addEventListener("focus", (ev) => onHover(n, ev)); hit.addEventListener("blur", () => onHover(null))
          g.appendChild(hit)
        }
      }

      // The red pen sits on top and is redrawn for each step.
      const pen = document.createElementNS(NS, "g"); svg.appendChild(pen)
      return {
        highlight(list) {
          pen.innerHTML = ""
          const set = list ? new Set(list) : null
          for (const [id, g] of els) g.classList.toggle("sk-dim", !!set && !set.has(id) && !groupIds.has(id))
          if (!set) return
          for (const id of list) {
            const b = L.abs[id]; if (!b || groupIds.has(id)) continue
            pen.appendChild(rc.ellipse(b.x + b.w / 2, b.y + b.h / 2, b.w + 30, b.h + 26, { seed: seedOf(id + "pen"), roughness: clean ? 0.4 : 2.2, stroke: v("--sk-pen"), strokeWidth: 2.2, bowing: clean ? 0 : 2 }))
          }
        },
      }
    }

    // Draws a scene into `target` (an element or a selector). Options: { style: "hand" | "clean" }.
    async function draw(target, scene, options = {}) {
      const host = typeof target === "string" ? document.querySelector(target) : target
      if (!host) throw new Error(`Sketch: no element matches ${target}`)
      ensureStyle()
      const clean = options.style === "clean"
      const wrap = document.createElement("div"); wrap.className = "sk" + (clean ? " sk-clean" : "")
      host.replaceChildren(wrap)
      const errors = validate(scene)
      if (errors.length) {
        const p = document.createElement("p"); p.className = "sk-error"
        p.textContent = "Sketch could not draw this scene:\n- " + errors.join("\n- ")
        wrap.appendChild(p)
        return { errors }
      }
      if (scene.title) { const h = document.createElement("h2"); h.className = "sk-title"; h.textContent = scene.title; wrap.appendChild(h) }
      if (scene.subtitle) { const s = document.createElement("p"); s.className = "sk-sub"; s.textContent = scene.subtitle; wrap.appendChild(s) }
      const stage = document.createElement("div"); stage.className = "sk-stage"
      const tip = document.createElement("div"); tip.className = "sk-tip"; tip.hidden = true
      const svg = document.createElementNS(NS, "svg")
      stage.append(svg, tip); wrap.appendChild(stage)

      await Promise.all([loadScript(ELK_URL, "ELK"), loadScript(ROUGH_URL, "rough"), clean ? null : loadFonts()])
      const fonts = clean
        ? { label: '600 15px "IBM Plex Sans", system-ui, sans-serif', sub: '400 12px "IBM Plex Sans", system-ui, sans-serif', edge: '400 12px "IBM Plex Sans", system-ui, sans-serif' }
        : { label: '700 17px Kalam, "Comic Sans MS", cursive', sub: '400 13px Kalam, "Comic Sans MS", cursive', edge: '400 13px Kalam, "Comic Sans MS", cursive' }
      const measure = (t, kind) => { ctx.font = fonts[kind]; return ctx.measureText(t).width }
      const L = flatten(await new root.ELK().layout(elkGraph(scene, measure)))

      const onHover = (n, ev) => {
        if (!n) { tip.hidden = true; return }
        tip.textContent = n.description; tip.hidden = false
        const r = stage.getBoundingClientRect()
        const px = ev && ev.clientX ? ev.clientX - r.left + stage.scrollLeft : 20
        const py = ev && ev.clientY ? ev.clientY - r.top : 20
        tip.style.left = Math.max(0, Math.min(px + 14, stage.scrollWidth - 270)) + "px"; tip.style.top = py + 16 + "px"
      }
      let view = paint(scene, svg, L, wrap, onHover, clean)

      const steps = Array.isArray(scene.steps) ? scene.steps : []
      let step = -1, bar = null
      const show = () => {
        view.highlight(step >= 0 ? steps[step].highlight : null)
        if (!bar) return
        const [prev, next] = bar.querySelectorAll("button")
        prev.disabled = step < 0
        next.textContent = step < 0 ? "Walk me through it" : step === steps.length - 1 ? "Show everything" : "Next"
        const box = bar.querySelector(".sk-step"); box.replaceChildren()
        if (step >= 0) { const b = document.createElement("b"); b.textContent = steps[step].title || ""; const s = document.createElement("span"); s.textContent = steps[step].text || ""; box.append(b, s) }
        else { const s = document.createElement("span"); s.textContent = `${steps.length} steps. Use the buttons or the arrow keys.`; box.append(s) }
        bar.querySelector(".sk-count").textContent = step >= 0 ? `${step + 1} / ${steps.length}` : ""
      }
      const go = (d) => { step = d > 0 ? (step === steps.length - 1 ? -1 : step + 1) : Math.max(-1, step - 1); show() }
      if (steps.length) {
        bar = document.createElement("div"); bar.className = "sk-steps"
        bar.innerHTML = '<button type="button" aria-label="Previous step">Back</button><button type="button">Walk me through it</button><div class="sk-step" aria-live="polite"></div><span class="sk-count"></span>'
        const [prev, next] = bar.querySelectorAll("button")
        prev.addEventListener("click", () => go(-1)); next.addEventListener("click", () => go(1))
        wrap.appendChild(bar)
        wrap.tabIndex = -1
        wrap.addEventListener("keydown", (e) => { if (e.key === "ArrowRight") go(1); if (e.key === "ArrowLeft") go(-1) })
      }
      show()

      // Colours come from CSS variables at paint time, so a theme switch repaints over the same layout.
      const repaint = () => { view = paint(scene, svg, L, wrap, onHover, clean); show() }
      const mq = root.matchMedia ? root.matchMedia("(prefers-color-scheme: dark)") : null
      mq && mq.addEventListener("change", repaint)
      const mo = new MutationObserver(repaint); mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] })
      return {
        errors: [],
        step: (i) => { step = Math.max(-1, Math.min(steps.length - 1, i)); show() },
        destroy: () => { mq && mq.removeEventListener("change", repaint); mo.disconnect(); host.replaceChildren() },
      }
    }

    api.draw = draw
  }

  root.Sketch = api
  if (typeof module !== "undefined" && module.exports) module.exports = api
})(typeof globalThis !== "undefined" ? globalThis : this)
