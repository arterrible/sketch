---
name: sketch
description: Draw an explanation instead of writing a wall of text. Hand-drawn, interactive diagrams (systems, flows, step-by-step walkthroughs, comparisons, architecture) laid out automatically from a small JSON scene. Use by default whenever a system, process, flow, comparison or "how does X work" answer would land better as a picture, and whenever the user asks for a diagram, sketch, chart of boxes and arrows, or a visual explanation. Not for data charts (bars, lines), sequence diagrams, Gantt charts or state machines.
---

# Sketch

The user is a visual learner. When an answer has a shape (parts that connect, a flow, stages, a before and after, a comparison), draw it, then explain it in two to four sentences. Do not wait to be asked.

You write **what** to draw as JSON. Sketch computes every position and routes every arrow. **Never write coordinates, sizes or SVG.**

## In a chat (the visualisation widget)

Pass exactly this as the widget code, with the scene in the `draw` call. No other markup, styles or text:

```html
<div id="sketch" style="min-height: 320px"></div>
<script src="https://cdn.jsdelivr.net/npm/@arterrible/sketch@0.1.0/dist/sketch.js"></script>
<script>
  Sketch.draw("#sketch", {/* scene JSON */});
</script>
```

If the widget shows "Sketch could not draw this scene", fix every field it names and draw again.

## In an artifact page

Same script tag (jsDelivr's `/npm/` path is on the artifact allowlist). One `<div>` per diagram, one `Sketch.draw` call each. The page still needs its own pinch zoom (devkit `artifact-mobile-zoom`).

## Scene JSON

```json
{
  "title": "How a web request works",
  "subtitle": "optional, one line",
  "direction": "right",
  "groups": [{ "id": "net", "label": "Internet" }],
  "nodes": [
    { "id": "browser", "label": "Browser", "sub": "Chrome", "description": "Shown on hover" },
    { "id": "server", "label": "Server", "group": "net", "tone": "accent" },
    { "id": "db", "label": "Database", "group": "net", "shape": "cylinder" }
  ],
  "edges": [
    { "from": "browser", "to": "server", "label": "HTTPS" },
    { "from": "server", "to": "db", "style": "dashed" }
  ],
  "steps": [
    { "title": "Request", "text": "One or two sentences.", "highlight": ["browser", "browser->server", "server"] }
  ]
}
```

- `direction`: `"right"` for flows, `"down"` for layers and hierarchies.
- Nodes: `id`, `label` (one to four words), optional `sub` (a muted second line, a few words), `description` (hover text, one sentence), `group`, `shape` (`box`, `rounded`, `diamond` = decision, `cylinder` = storage, `person` = actor, `note`), `tone` (`accent` = the key element, `muted` = context, `store`, `warn`, `done`).
- Groups: `id`, `label`, optional `parent` (another group's id). A group draws as a dashed band.
- Edges: `from`, `to` (node ids), optional `label` (one or two words), `style` (`solid`, `dashed`).
- Steps: `title`, `text`, `highlight` (node, group and edge ids; an edge id is `"from->to"`). Each step circles its highlights in red pen and fades the rest.
- Ids are unique across groups and nodes. Write nodes and edges in reading order: the layout respects it.

## Patterns, pick one per drawing

- **Structure** ("what is it made of?"): groups for areas, `direction: "down"`.
- **Flow** ("how does it work?"): a chain left to right plus one step per stage.
- **Decision** ("what happens if?"): a `diamond` with labelled edges (`yes`, `no`).
- **Comparison** ("X vs Y"): one group per option, the same nodes in the same order, `accent` on the difference.
- **Metaphor** ("explain it simply"): a group for the real thing and one for an everyday counterpart, dashed edges between matching parts.

## Budget

Six to fourteen nodes reads best. Past about eighteen, draw an overview and offer a second drawing for the detail. Add steps whenever the order matters; three to six is right.
