# Sketch

Claude describes **what** to draw. Sketch decides **where**: it lays the scene out with [ELK](https://eclipse.dev/elk/), routes the arrows at right angles, and draws it by hand with [rough.js](https://roughjs.com). Hover a box for details; walk through the steps and each one is circled in red pen while the rest fades.

Inspired by [ddkbs/sketchy](https://github.com/ddkbs/sketchy); a clean-room take built to run anywhere a script tag does, including claude.ai artifact pages.

## Use

```html
<div id="sketch"></div>
<script src="https://cdn.jsdelivr.net/npm/@arterrible/sketch@0.1.0/dist/sketch.js"></script>
<script>
  Sketch.draw("#sketch", {
    title: "How a web request works",
    direction: "right",
    nodes: [
      { id: "browser", label: "Browser", description: "Sends the request" },
      { id: "server", label: "Server", tone: "accent" },
      { id: "db", label: "Database", shape: "cylinder" }
    ],
    edges: [
      { from: "browser", to: "server", label: "HTTPS" },
      { from: "server", to: "db" }
    ],
    steps: [{ title: "Request", text: "The browser calls the server.", highlight: ["browser", "browser->server"] }]
  })
</script>
```

`Sketch.draw(target, scene, { style: "hand" | "clean" })` returns `{ errors, step(i), destroy() }`. A scene that does not validate draws a message naming every field to fix. The full scene format and when to draw are in [skill/SKILL.md](skill/SKILL.md), which is also the Claude skill.

Sketch loads elkjs and rough.js from jsDelivr on first use (pinned versions, about 0.5 MB compressed, then cached) and Kalam and Caveat from Google Fonts. Nothing else is fetched. It follows light and dark mode through CSS variables (`--sk-*`), which a page can override.

## Develop

```bash
npm run build   # stamps the version into dist/sketch.js and pins the skill's URL
npm test        # node --test, no dependencies
open demo/index.html
```

Release: bump `version` in package.json, `npm run build`, commit, then push a tag `v<version>` or run the publish workflow by hand. It tests and publishes to npm with provenance.

## Licence

MIT
