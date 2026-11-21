/*! @arterrible/sketch: Claude describes what to draw, Sketch lays it out and draws it. MIT licence. */
;(function (root) {
  const VERSION = "0.2.0"
  const ELK_URL = "https://cdn.jsdelivr.net/npm/elkjs@0.9.3/lib/elk.bundled.js"
  const ROUGH_URL = "https://cdn.jsdelivr.net/npm/roughjs@4.6.6/bundled/rough.js"
  const FONTS_URL = "https://fonts.googleapis.com/css2?family=Kalam:wght@400;700&family=Caveat:wght@600;700&display=swap"
  const NS = "http://www.w3.org/2000/svg"

  const SHAPES = ["box", "rounded", "diamond", "cylinder", "person", "note"]
  const TONES = ["accent", "muted", "store", "warn", "done"]
  const THEMES = ["hand", "clean", "pro", "blueprint"]

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
      if (e && e.tone && !TONES.includes(e.tone)) errors.push(`edges[${i}]: tone "${e.tone}" is not one of ${TONES.join(", ")}`)
      if (e) edgeIds.add(`${e.from}->${e.to}`)
    })
    ;(Array.isArray(scene.steps) ? scene.steps : []).forEach((s, i) => {
      for (const h of (s && s.highlight) || []) if (!ids.has(h) && !edgeIds.has(h)) errors.push(`steps[${i}]: highlight "${h}" is not a node, group or edge (edges are "from->to")`)
    })
    if (scene.direction && !["right", "down"].includes(scene.direction)) errors.push(`direction must be "right" or "down"`)
    if (scene.theme && !THEMES.includes(scene.theme)) errors.push(`theme "${scene.theme}" is not one of ${THEMES.join(", ")}`)
    if (scene.legend != null) {
      if (typeof scene.legend !== "object" || Array.isArray(scene.legend)) errors.push("legend must be an object of tone: label")
      else for (const k of Object.keys(scene.legend)) if (!TONES.includes(k)) errors.push(`legend: "${k}" is not a tone (${TONES.join(", ")})`)
    }
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
    // MODEL_ORDER reads child order as reading order, so a group sits where its first node was written.
    // Pushing groups first made every ungrouped node "later", and its edges into a group ran backwards.
    const first = new Map()
    scene.nodes.forEach((n, i) => { for (const p of [n.id, ...chain(n.id)]) if (!first.has(p)) first.set(p, i) })
    const order = (c) => (first.has(c.id) ? first.get(c.id) : Infinity)
    for (const g of groups.values()) box[parentOf(g.id)].children.push(box[g.id])
    for (const n of scene.nodes) { const s = nodeSize(n, measure); box[parentOf(n.id)].children.push({ id: n.id, width: s.w, height: s.h }) }
    for (const b of Object.values(box)) b.children.sort((x, y) => order(x) - order(y))
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

  // A viewer's own pick (from the dropdown) wins, then the caller's, then the scene's.
  function pickTheme({ stored, option, style, scene } = {}) {
    for (const t of [stored, option, style, scene]) if (THEMES.includes(t)) return t
    return "hand"
  }

  const seedOf = (s) => { let h = 7; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return (h % 2147483646) + 1 }

  const api = { VERSION, SHAPES, TONES, THEMES, validate, elkGraph, nodeSize, flatten, seedOf, pickTheme }

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

    const DARK = `--sk-paper:#1a1c20; --sk-line:#2c2f35; --sk-fg:#ece8df; --sk-muted:#a49e92; --sk-ink:#e9e5dc;
  --sk-accent:#8fb3ff; --sk-accent-fill:#1f2a40; --sk-store:#c1adff; --sk-store-fill:#2a2340; --sk-warn:#fbbf24; --sk-warn-fill:#3a2c12; --sk-done:#34d399; --sk-done-fill:#12302a;
  --sk-group-fill:#202227; --sk-group-ink:#8f897d; --sk-muted-fill:#1e2024; --sk-pen:#ff6b5a; --sk-edge:#c9c4b8;`
    const PRO_DARK = `--sk-canvas:#0b1120; --sk-dot:#1e293b; --sk-paper:#111827; --sk-line:#1f2937; --sk-fg:#e2e8f0; --sk-muted:#94a3b8; --sk-ink:#e2e8f0; --sk-node:#475569;
  --sk-accent:#60a5fa; --sk-accent-fill:#172554; --sk-store:#a78bfa; --sk-store-fill:#2e1065; --sk-warn:#f87171; --sk-warn-fill:#450a0a; --sk-done:#34d399; --sk-done-fill:#022c22;
  --sk-group-fill:rgba(30,41,59,.45); --sk-group-ink:#94a3b8; --sk-muted-fill:#1e293b; --sk-pen:#f87171; --sk-edge:#94a3b8;`
    const dark = (sel, vars) => `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) ${sel} { ${vars} } }\n:root[data-theme="dark"] ${sel} { ${vars} }`
    const STYLE = `
.sk { --sk-paper:#fdfcf8; --sk-line:#ddd8cb; --sk-fg:#23211d; --sk-muted:#6b665c; --sk-ink:#2b2a27; --sk-accent:#2457c5; --sk-accent-fill:#e6eeff;
  --sk-store:#6b4fd8; --sk-store-fill:#f0ebff; --sk-warn:#b45309; --sk-warn-fill:#fff4e5; --sk-done:#047857; --sk-done-fill:#e9f7f0;
  --sk-group-fill:#f4f1e8; --sk-group-ink:#8d8677; --sk-muted-fill:#f2f1ed; --sk-pen:#d33a2c; --sk-edge:#4a4740;
  --sk-hand:"Kalam","Comic Sans MS",cursive; --sk-title:"Caveat","Kalam",cursive; --sk-sans:"IBM Plex Sans",system-ui,"Segoe UI",sans-serif;
  --sk-mono:"JetBrains Mono",ui-monospace,"SFMono-Regular",Menlo,Consolas,monospace;
  color:var(--sk-fg); font-family:var(--sk-sans); font-size:15px; line-height:1.5; display:flex; flex-direction:column; gap:8px; }
${dark(".sk", DARK)}
.sk.sk-t-pro { --sk-canvas:#f8fafc; --sk-dot:#d5dde8; --sk-paper:#ffffff; --sk-line:#e2e8f0; --sk-fg:#0f172a; --sk-muted:#64748b; --sk-ink:#1e293b; --sk-node:#94a3b8;
  --sk-accent:#2563eb; --sk-accent-fill:#eff6ff; --sk-store:#7c3aed; --sk-store-fill:#f5f3ff; --sk-warn:#dc2626; --sk-warn-fill:#fef2f2; --sk-done:#059669; --sk-done-fill:#ecfdf5;
  --sk-group-fill:rgba(241,245,249,.7); --sk-group-ink:#64748b; --sk-muted-fill:#f1f5f9; --sk-pen:#dc2626; --sk-edge:#64748b; }
${dark(".sk.sk-t-pro", PRO_DARK)}
.sk.sk-t-blueprint, :root[data-theme] .sk.sk-t-blueprint { --sk-canvas:#0f2d5c; --sk-dot:rgba(255,255,255,.07); --sk-paper:#123468; --sk-line:#2a4f86; --sk-fg:#eef4ff; --sk-muted:#a9c1e8; --sk-ink:#eef4ff; --sk-node:#cfe0ff;
  --sk-accent:#ffd166; --sk-accent-fill:rgba(255,209,102,.12); --sk-store:#9be7ff; --sk-store-fill:rgba(155,231,255,.1); --sk-warn:#ff9b85; --sk-warn-fill:rgba(255,155,133,.12); --sk-done:#8ef0b6; --sk-done-fill:rgba(142,240,182,.1);
  --sk-group-fill:rgba(255,255,255,.04); --sk-group-ink:#a9c1e8; --sk-muted-fill:rgba(255,255,255,.05); --sk-pen:#ffd166; --sk-edge:#cfe0ff; }
.sk-head { display:flex; align-items:flex-start; gap:12px; }
.sk-head > div { flex:1 1 auto; min-width:0; }
.sk-pick { flex:0 0 auto; font:inherit; font-size:13px; color:var(--sk-fg); background:var(--sk-paper); border:1px solid var(--sk-line); border-radius:8px; padding:6px 8px; min-height:34px; cursor:pointer; }
.sk-pick:focus-visible { outline:2px solid var(--sk-accent); outline-offset:2px; }
.sk-title { margin:0; font-family:var(--sk-title); font-size:30px; line-height:1.1; font-weight:700; }
.sk:not(.sk-t-hand) .sk-title { font-family:var(--sk-sans); font-size:20px; }
.sk-sub { color:var(--sk-muted); font-size:14px; margin:0; }
.sk-stage { position:relative; overflow-x:auto; }
.sk-t-pro .sk-stage, .sk-t-blueprint .sk-stage { background-color:var(--sk-canvas); background-image:radial-gradient(var(--sk-dot) 1.2px, transparent 1.3px); background-size:18px 18px; border:1px solid var(--sk-line); border-radius:12px; padding:12px; }
.sk-t-blueprint .sk-stage { background-image:linear-gradient(var(--sk-dot) 1px, transparent 1px), linear-gradient(90deg, var(--sk-dot) 1px, transparent 1px); background-size:20px 20px; }
.sk.sk-t-blueprint { background:var(--sk-canvas); padding:16px; border-radius:14px; }
.sk.sk-t-pro { background:var(--sk-paper); padding:16px; border-radius:14px; border:1px solid var(--sk-line); }
.sk-t-blueprint .sk-stage { border:0; padding:0; }
.sk-stage svg { display:block; margin:0 auto; max-width:100%; height:auto; }
.sk-el { transition:opacity .25s ease; } .sk-el.sk-dim { opacity:.18; }
.sk-hit { cursor:help; } .sk-hit:focus { outline:none; }
.sk-tip { position:absolute; pointer-events:none; background:var(--sk-fg); color:var(--sk-paper); font-size:13px; line-height:1.4; padding:8px 10px; border-radius:8px; max-width:260px; z-index:5; }
.sk-legend { display:flex; flex-wrap:wrap; gap:6px 16px; font-size:13px; color:var(--sk-muted); }
.sk-legend span { display:inline-flex; align-items:center; gap:6px; }
.sk-legend i { width:14px; height:10px; border-radius:3px; border:1.5px solid; display:inline-block; }
.sk-t-pro .sk-legend, .sk-t-blueprint .sk-legend { font-family:var(--sk-mono); font-size:12px; }
.sk-steps { display:flex; flex-wrap:wrap; gap:10px 14px; align-items:center; border-top:1px dashed var(--sk-line); padding-top:10px; }
.sk-steps button { font:inherit; font-size:14px; background:transparent; color:var(--sk-fg); border:1.5px solid var(--sk-ink); border-radius:10px 12px 9px 11px; padding:8px 14px; min-height:40px; cursor:pointer; }
.sk:not(.sk-t-hand) .sk-steps button { border-radius:8px; border-width:1px; }
.sk-steps button:disabled { opacity:.35; cursor:default; }
.sk-steps button:focus-visible { outline:2px solid var(--sk-accent); outline-offset:2px; }
.sk-step { flex:1 1 260px; min-width:0; } .sk-step b { font-family:var(--sk-hand); font-size:18px; display:block; line-height:1.2; }
.sk:not(.sk-t-hand) .sk-step b { font-family:var(--sk-sans); font-size:15px; }
.sk-step span { color:var(--sk-muted); font-size:14px; } .sk-count { color:var(--sk-muted); font-size:14px; }
.sk-error { color:var(--sk-warn); font-size:14px; white-space:pre-wrap; }
@media (prefers-reduced-motion: reduce) { .sk-el { transition:none; } }`
    const ensureStyle = () => {
      if (document.getElementById("sketch-style")) return
      const s = document.createElement("style"); s.id = "sketch-style"; s.textContent = STYLE; document.head.appendChild(s)
    }

    const SANS = '"IBM Plex Sans", system-ui, sans-serif', MONO = '"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace'
    const LOOKS = {
      hand: { name: "Hand-drawn", rough: 1, radius: 6, fonts: { label: '700 17px Kalam, "Comic Sans MS", cursive', sub: '400 13px Kalam, "Comic Sans MS", cursive', edge: '400 13px Kalam, "Comic Sans MS", cursive', group: '600 24px Caveat, Kalam, cursive' } },
      clean: { name: "Clean", rough: 0, radius: 6, fonts: { label: `600 15px ${SANS}`, sub: `400 12px ${SANS}`, edge: `400 12px ${SANS}`, group: `600 13px ${SANS}` } },
      pro: { name: "Pro", rough: 0, radius: 10, pill: true, tint: true, glyph: true, shadow: true, fonts: { label: `600 14px ${SANS}`, sub: `400 11.5px ${MONO}`, edge: `500 11px ${MONO}`, group: `600 12px ${MONO}` } },
      blueprint: { name: "Blueprint", rough: 0, radius: 2, pill: true, tint: true, fonts: { label: `600 14px ${MONO}`, sub: `400 11.5px ${MONO}`, edge: `400 11px ${MONO}`, group: `600 12px ${MONO}` } },
    }
    const PREF = "sketch-theme"
    const readPref = () => { try { return root.localStorage.getItem(PREF) } catch { return null } }
    const writePref = (t) => { try { root.localStorage.setItem(PREF, t) } catch {} }

    const ctx = document.createElement("canvas").getContext("2d")
    let uid = 0

    function paint(scene, svg, L, wrap, onHover, T) {
      svg.innerHTML = ""
      const v = (name) => getComputedStyle(wrap).getPropertyValue(name).trim()
      const F = T.fonts, rough0 = T.rough
      const pad = 14
      svg.setAttribute("viewBox", `${-pad} ${-pad} ${L.width + pad * 2} ${L.height + pad * 2}`)
      svg.setAttribute("width", L.width + pad * 2)
      svg.setAttribute("role", "img")
      svg.setAttribute("aria-label", scene.title || "Diagram")
      const rc = root.rough.svg(svg)
      const ink = v("--sk-ink"), edgeInk = v("--sk-edge")
      const els = new Map()
      const groupIds = new Set((scene.groups || []).map((g) => g.id))
      const nodeById = new Map(scene.nodes.map((n) => [n.id, n]))
      const toneColours = { accent: ["--sk-accent", "--sk-accent-fill"], store: ["--sk-store", "--sk-store-fill"], warn: ["--sk-warn", "--sk-warn-fill"], done: ["--sk-done", "--sk-done-fill"], muted: ["--sk-group-ink", "--sk-muted-fill"] }
      const toneOf = (n) => n.tone || (n.shape === "cylinder" ? "store" : null)
      const layer = (id) => { const g = document.createElementNS(NS, "g"); g.classList.add("sk-el"); if (id) { g.dataset.id = id; els.set(id, g) } svg.appendChild(g); return g }
      const text = (g, x, y, str, font, fill, anchor = "middle") => {
        const t = document.createElementNS(NS, "text")
        t.setAttribute("x", x); t.setAttribute("y", y); t.setAttribute("text-anchor", anchor); t.setAttribute("dominant-baseline", "middle")
        t.setAttribute("fill", fill); t.style.font = font; t.textContent = str; g.appendChild(t)
      }
      const rect = (g, x, y, w, h, attrs) => {
        const r = document.createElementNS(NS, "rect")
        for (const [k, val] of Object.entries({ x, y, width: w, height: h, ...attrs })) r.setAttribute(k, val)
        g.appendChild(r); return r
      }
      let shadow = null
      if (T.shadow) {
        shadow = `sk-shadow-${++uid}`
        const defs = document.createElementNS(NS, "defs")
        defs.innerHTML = `<filter id="${shadow}" x="-10%" y="-10%" width="120%" height="140%"><feDropShadow dx="0" dy="1.5" stdDeviation="2" flood-color="#0f172a" flood-opacity=".12"/></filter>`
        svg.appendChild(defs)
      }

      for (const gdef of scene.groups || []) {
        const b = L.abs[gdef.id]; if (!b) continue
        const g = layer(gdef.id)
        g.appendChild(rc.rectangle(b.x, b.y, b.w, b.h, { seed: seedOf(gdef.id), roughness: 1.1 * rough0, stroke: v("--sk-group-ink"), strokeWidth: 1.2, strokeLineDash: [7, 6], fill: v("--sk-group-fill"), fillStyle: "solid" }))
      }

      for (const [id, e] of Object.entries(L.edges)) {
        const def = (scene.edges || []).find((x) => `${x.from}->${x.to}` === id)
        const src = def && nodeById.get(def.from)
        const tone = def && (def.tone || (T.tint && src && toneOf(src) !== "muted" ? toneOf(src) : null))
        const colour = tone && toneColours[tone] ? v(toneColours[tone][0]) : edgeInk
        const g = layer(id)
        for (const s of e.sections) {
          const pts = [s.startPoint, ...(s.bendPoints || []), s.endPoint].map((p) => [p.x + e.ox, p.y + e.oy])
          const opts = { seed: seedOf(id), roughness: 0.9 * rough0, stroke: colour, strokeWidth: T.pill ? 1.5 : 1.6, bowing: rough0 ? 1.2 : 0 }
          if (def && def.style === "dashed") opts.strokeLineDash = [6, 6]
          g.appendChild(rc.linearPath(pts, opts))
          const [x2, y2] = pts[pts.length - 1], [x1, y1] = pts[pts.length - 2]
          const ang = Math.atan2(y2 - y1, x2 - x1), len = 11, spread = 0.45
          g.appendChild(rc.polygon([[x2, y2], [x2 - len * Math.cos(ang - spread), y2 - len * Math.sin(ang - spread)], [x2 - len * Math.cos(ang + spread), y2 - len * Math.sin(ang + spread)]],
            { seed: seedOf(id + "h"), roughness: 0.6 * rough0, stroke: colour, fill: colour, fillStyle: "solid", strokeWidth: 1.2 }))
        }
        for (const lab of e.labels) {
          const x = lab.x + e.ox, y = lab.y + e.oy
          rect(g, x, y, lab.width, lab.height, T.pill ? { rx: lab.height / 2, fill: v("--sk-paper"), stroke: colour, "stroke-width": 1 } : { rx: 6, fill: v("--sk-paper") })
          text(g, x + lab.width / 2, y + lab.height / 2 + 1, lab.text, F.edge, T.pill ? colour : v("--sk-muted"))
        }
      }

      // Group labels go above the edges, on a chip, so an arrow entering a group never runs through its name.
      const labels = layer(null)
      for (const gdef of scene.groups || []) {
        const b = L.abs[gdef.id]; if (!b || !gdef.label) continue
        ctx.font = F.group
        const w = ctx.measureText(gdef.label).width + 12
        rect(labels, b.x + 10, b.y + 10, w, 24, T.pill ? { rx: 6, fill: v("--sk-paper"), stroke: v("--sk-group-ink"), "stroke-width": 1 } : { rx: 6, fill: v("--sk-group-fill") })
        text(labels, b.x + 16, b.y + 23, gdef.label, F.group, v("--sk-group-ink"), "start")
      }

      for (const n of scene.nodes) {
        const b = L.abs[n.id]; if (!b) continue
        const g = layer(n.id)
        if (shadow) g.setAttribute("filter", `url(#${shadow})`)
        const tone = toneOf(n)
        const [sv, fv] = toneColours[tone] || [null, null]
        const plain = T.glyph || T.pill ? v("--sk-node") : ink
        const o = { seed: seedOf(n.id), roughness: 1.2 * rough0, stroke: sv ? v(sv) : plain, strokeWidth: tone === "accent" ? 2.2 : T.pill ? 1.4 : 1.6, fill: fv ? v(fv) : v("--sk-paper"), fillStyle: "solid" }
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
          const r = n.shape === "rounded" ? 20 : T.radius
          g.appendChild(rc.path(`M ${x + r} ${y} H ${x + w - r} Q ${x + w} ${y} ${x + w} ${y + r} V ${y + h - r} Q ${x + w} ${y + h} ${x + w - r} ${y + h} H ${x + r} Q ${x} ${y + h} ${x} ${y + h - r} V ${y + r} Q ${x} ${y} ${x + r} ${y} Z`, o))
          if (T.glyph && sv) { const c = document.createElementNS(NS, "circle"); c.setAttribute("cx", x + 11); c.setAttribute("cy", y + 11); c.setAttribute("r", 3.5); c.setAttribute("fill", v(sv)); g.appendChild(c) }
        }
        if (n.sub && n.shape !== "person") {
          text(g, cx, labelY - 9, n.label, F.label, T.pill ? v("--sk-fg") : ink)
          text(g, cx, labelY + 12, n.sub, F.sub, v("--sk-muted"))
        } else text(g, cx, labelY, n.label, F.label, T.pill ? v("--sk-fg") : ink)
        if (n.description) {
          const hit = rect(g, x, y, w, h, { fill: "transparent", tabindex: "0", "aria-label": `${n.label}: ${n.description}` })
          hit.classList.add("sk-hit")
          hit.addEventListener("pointerenter", (ev) => onHover(n, ev)); hit.addEventListener("pointermove", (ev) => onHover(n, ev))
          hit.addEventListener("pointerleave", () => onHover(null)); hit.addEventListener("focus", (ev) => onHover(n, ev)); hit.addEventListener("blur", () => onHover(null))
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
            pen.appendChild(rc.ellipse(b.x + b.w / 2, b.y + b.h / 2, b.w + 30, b.h + 26, { seed: seedOf(id + "pen"), roughness: rough0 ? 2.2 : 0.4, stroke: v("--sk-pen"), strokeWidth: 2.2, bowing: rough0 ? 2 : 0 }))
          }
        },
      }
    }

    // Draws a scene into `target` (an element or a selector).
    // Options: { theme: "hand" | "clean" | "pro" | "blueprint", picker: true }. `style` is the 0.1 name for theme.
    async function draw(target, scene, options = {}) {
      const host = typeof target === "string" ? document.querySelector(target) : target
      if (!host) throw new Error(`Sketch: no element matches ${target}`)
      ensureStyle()
      const picker = options.picker !== false
      let theme = pickTheme({ stored: picker ? readPref() : null, option: options.theme, style: options.style, scene: scene && scene.theme })
      const wrap = document.createElement("div"); wrap.className = `sk sk-t-${theme}`
      host.replaceChildren(wrap)
      const errors = validate(scene)
      if (errors.length) {
        const p = document.createElement("p"); p.className = "sk-error"
        p.textContent = "Sketch could not draw this scene:\n- " + errors.join("\n- ")
        wrap.appendChild(p)
        return { errors }
      }
      const head = document.createElement("div"); head.className = "sk-head"
      const words = document.createElement("div"); head.appendChild(words)
      if (scene.title) { const h = document.createElement("h2"); h.className = "sk-title"; h.textContent = scene.title; words.appendChild(h) }
      if (scene.subtitle) { const s = document.createElement("p"); s.className = "sk-sub"; s.textContent = scene.subtitle; words.appendChild(s) }
      let select = null
      if (picker) {
        select = document.createElement("select"); select.className = "sk-pick"; select.setAttribute("aria-label", "Diagram theme")
        for (const t of THEMES) { const o = document.createElement("option"); o.value = t; o.textContent = LOOKS[t].name; select.appendChild(o) }
        select.value = theme
        select.addEventListener("change", () => { writePref(select.value); document.dispatchEvent(new CustomEvent("sketch-theme", { detail: select.value })) })
        head.appendChild(select)
      }
      if (scene.title || scene.subtitle || picker) wrap.appendChild(head)
      const stage = document.createElement("div"); stage.className = "sk-stage"
      const tip = document.createElement("div"); tip.className = "sk-tip"; tip.hidden = true
      const svg = document.createElementNS(NS, "svg")
      stage.append(svg, tip); wrap.appendChild(stage)
      if (scene.legend) {
        const lg = document.createElement("div"); lg.className = "sk-legend"
        for (const [tone, label] of Object.entries(scene.legend)) {
          const s = document.createElement("span"), i = document.createElement("i")
          i.style.borderColor = `var(--sk-${tone === "muted" ? "group-ink" : tone})`; i.style.background = `var(--sk-${tone}-fill)`
          s.append(i, String(label)); lg.appendChild(s)
        }
        wrap.appendChild(lg)
      }

      const onHover = (n, ev) => {
        if (!n) { tip.hidden = true; return }
        tip.textContent = n.description; tip.hidden = false
        const r = stage.getBoundingClientRect()
        const px = ev && ev.clientX ? ev.clientX - r.left + stage.scrollLeft : 20
        const py = ev && ev.clientY ? ev.clientY - r.top : 20
        tip.style.left = Math.max(0, Math.min(px + 14, stage.scrollWidth - 270)) + "px"; tip.style.top = py + 16 + "px"
      }

      const steps = Array.isArray(scene.steps) ? scene.steps : []
      let step = -1, bar = null, view = null, L = null
      const show = () => {
        if (view) view.highlight(step >= 0 ? steps[step].highlight : null)
        if (!bar) return
        const [prev, next] = bar.querySelectorAll("button")
        prev.disabled = step < 0
        next.textContent = step < 0 ? "Walk me through it" : step === steps.length - 1 ? "Show everything" : "Next"
        const box = bar.querySelector(".sk-step"); box.replaceChildren()
        if (step >= 0) { const b = document.createElement("b"); b.textContent = steps[step].title || ""; const s = document.createElement("span"); s.textContent = steps[step].text || ""; box.append(b, s) }
        else { const s = document.createElement("span"); s.textContent = `${steps.length} ${steps.length === 1 ? "step" : "steps"}. Use the buttons or the arrow keys.`; box.append(s) }
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

      // Each theme has its own fonts, so a switch lays out again; the latest switch wins a race.
      let run = 0
      const render = async (name) => {
        const mine = ++run
        theme = name; wrap.className = `sk sk-t-${name}`
        if (select) select.value = name
        const T = LOOKS[name]
        await Promise.all([loadScript(ELK_URL, "ELK"), loadScript(ROUGH_URL, "rough"), name === "hand" ? loadFonts() : null])
        const measure = (t, kind) => { ctx.font = T.fonts[kind]; return ctx.measureText(t).width }
        const out = flatten(await new root.ELK().layout(elkGraph(scene, measure)))
        if (mine !== run) return
        L = out
        view = paint(scene, svg, L, wrap, onHover, T)
        show()
      }
      await render(theme)

      // Colours come from CSS variables at paint time, so a light or dark switch repaints over the same layout.
      const repaint = () => { if (L) { view = paint(scene, svg, L, wrap, onHover, LOOKS[theme]); show() } }
      const onTheme = (e) => { if (picker && THEMES.includes(e.detail) && e.detail !== theme) render(e.detail) }
      const mq = root.matchMedia ? root.matchMedia("(prefers-color-scheme: dark)") : null
      mq && mq.addEventListener("change", repaint)
      const mo = new MutationObserver(repaint); mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] })
      document.addEventListener("sketch-theme", onTheme)
      return {
        errors: [],
        step: (i) => { step = Math.max(-1, Math.min(steps.length - 1, i)); show() },
        theme: (name) => (THEMES.includes(name) ? render(name) : Promise.resolve()),
        destroy: () => { mq && mq.removeEventListener("change", repaint); mo.disconnect(); document.removeEventListener("sketch-theme", onTheme); host.replaceChildren() },
      }
    }

    api.draw = draw
  }

  root.Sketch = api
  if (typeof module !== "undefined" && module.exports) module.exports = api
})(typeof globalThis !== "undefined" ? globalThis : this)
