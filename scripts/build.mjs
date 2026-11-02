// Copies src to dist with the package version stamped in, and fills the skill's pinned script URL.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const { version, name } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))

const src = readFileSync(join(root, "src/sketch.js"), "utf8")
const stamped = src.replace(/const VERSION = "[^"]*"/, `const VERSION = "${version}"`)
if (stamped === src && !src.includes(`const VERSION = "${version}"`)) throw new Error("VERSION marker not found in src/sketch.js")
mkdirSync(join(root, "dist"), { recursive: true })
writeFileSync(join(root, "dist/sketch.js"), stamped)
if (stamped !== src) writeFileSync(join(root, "src/sketch.js"), stamped)

const url = `https://cdn.jsdelivr.net/npm/${name}@${version}/dist/sketch.js`
const skillPath = join(root, "skill/SKILL.md")
const skill = readFileSync(skillPath, "utf8").replace(/https:\/\/cdn\.jsdelivr\.net\/npm\/@arterrible\/sketch@[^/]+\/dist\/sketch\.js/g, url)
writeFileSync(skillPath, skill)
console.log(`built ${name}@${version}: dist/sketch.js, skill pinned to ${url}`)
