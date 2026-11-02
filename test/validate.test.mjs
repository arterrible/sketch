import { test } from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const Sketch = require("../src/sketch.js")

const good = {
  title: "t",
  direction: "down",
  groups: [{ id: "g", label: "Group" }, { id: "g2", label: "Inner", parent: "g" }],
  nodes: [
    { id: "a", label: "A", group: "g" },
    { id: "b", label: "B", group: "g2", shape: "cylinder" },
    { id: "c", label: "C", tone: "accent" },
  ],
  edges: [{ from: "a", to: "b" }, { from: "b", to: "c", label: "x" }],
  steps: [{ title: "s", text: "t", highlight: ["a", "a->b", "g"] }],
}

test("a well-formed scene has no errors", () => {
  assert.deepEqual(Sketch.validate(good), [])
})

test("each mistake Claude is likely to make is named", () => {
  const bad = {
    direction: "up",
    nodes: [{ id: "a", label: "A", shape: "hexagon", tone: "loud", group: "nope" }, { id: "a", label: "" }],
    groups: [{ id: "g", parent: "missing" }],
    edges: [{ from: "a", to: "zz" }],
    steps: [{ highlight: ["a->zz", "ghost"] }],
  }
  const errors = Sketch.validate(bad).join("\n")
  for (const fragment of ['shape "hexagon"', 'tone "loud"', 'group "nope"', 'duplicate id "a"', "label is required", 'parent "missing"', 'to "zz"', 'highlight "ghost"', "direction"]) {
    assert.match(errors, new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), fragment)
  }
  assert.deepEqual(Sketch.validate({}), ["nodes: at least one node is needed"])
})

test("edges are declared in the lowest common group, so ELK routes them inside it", () => {
  const measure = (t) => t.length * 8
  const graph = Sketch.elkGraph(good, measure)
  const g = graph.children.find((c) => c.id === "g")
  assert.equal(graph.layoutOptions["elk.direction"], "DOWN")
  assert.deepEqual(g.edges.map((e) => e.id), ["a->b"], "a and b both sit inside g")
  assert.deepEqual(graph.edges.map((e) => e.id), ["b->c"], "c is at the root")
  assert.equal(graph.edges[0].labels[0].text, "x")
  assert.equal(g.children.find((c) => c.id === "g2").children[0].id, "b")
})

test("node sizes grow with the label and the shape", () => {
  const m = (t) => t.length * 9
  assert.equal(Sketch.nodeSize({ label: "A" }, m).w, 116, "minimum width")
  assert.ok(Sketch.nodeSize({ label: "A much longer label here" }, m).w > 116)
  assert.equal(Sketch.nodeSize({ label: "A", sub: "s" }, m).h, 64)
  assert.equal(Sketch.nodeSize({ label: "A", shape: "diamond" }, m).h, 84)
})

test("flatten turns nested ELK output into absolute boxes", () => {
  const out = { id: "root", x: 0, y: 0, width: 300, height: 200, children: [{ id: "g", x: 10, y: 20, width: 100, height: 80, children: [{ id: "a", x: 5, y: 6, width: 30, height: 20 }], edges: [{ id: "a->a", sections: [{ startPoint: { x: 1, y: 1 }, endPoint: { x: 2, y: 2 } }] }] }], edges: [] }
  const L = Sketch.flatten(out)
  assert.deepEqual(L.abs.a, { x: 15, y: 26, w: 30, h: 20 })
  assert.equal(L.edges["a->a"].ox, 10)
  assert.equal(L.edges["a->a"].oy, 20)
})

test("seeds are stable and positive", () => {
  assert.equal(Sketch.seedOf("web"), Sketch.seedOf("web"))
  assert.notEqual(Sketch.seedOf("web"), Sketch.seedOf("mgr"))
  assert.ok(Sketch.seedOf("") > 0)
})
