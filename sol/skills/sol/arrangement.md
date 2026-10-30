# The arrangement

One person's rails, presets, layout and presses, in `sol/home/arrangement.json`. It is kept by the engine
(`sol/engine/src/arrange.ts`), never committed, and no new version of Sol moves it. Change it only through the
`arrange` tool, which goes through the same merge and check as Sol's window, writes the file whole and redraws every
window. Never edit the file by hand.

## The tool: `arrange`

| `do` | with | does |
|---|---|---|
| `get` | | each rail's presets and their buttons, the layout, the presses so far, who tidies the rail, then every button on the shelf with its line. Start here |
| `add` | `button`, `preset?`, `to?` | puts a button on a preset (at place `to`, 0 first; the end when left out) |
| `remove` | `button`, `preset?` | takes it off |
| `move` | `button`, `to?`, `preset?` | moves it within the preset |
| `new` | `name`, `buttons?` | a new preset on the rail, showing; its id is the name in small letters and dashes |
| `rename` | `preset`, `name` | |
| `delete` | `preset` | gone from every rail too |
| `show` | `preset` | the preset the rail shows |
| `layout` | `layout` | the sidebar: `plain`, `split` or `carousel` |
| `manage` | `manage` | their answer to the one ask (below): `agent` or `me` |
| `set` | `patch` | a raw patch, merged: objects merge, lists replace, `null` takes a key away |

`mode` (`home`, the default, or `cowork`) picks whose rail. With no `preset`, `add`, `remove` and `move` act on the
one the rail shows. Refused, with one line, and nothing changes: an 11th button on a preset ("a preset holds 10.
Make another preset?"), a rail left with no preset, a button not on the shelf in `new`.

## The file

```json
{
  "v": 1,
  "modes": ["home", "cowork"],
  "rails": { "home": [{ "presets": ["everyday", "build"], "at": "everyday" }], "cowork": [{ "presets": ["team"] }] },
  "presets": { "everyday": { "name": "Everyday", "buttons": ["call", "browser", "desk", "file-it", "page"] } },
  "layout": { "home": "plain" },
  "split": { "share": 0.5 },
  "usage": { "changes": { "n": 41, "last": "2026-10-22" } },
  "manage": null
}
```

- A part missing is Sol's own, from `sol/mac/src/buttons/presets.json`.
- `rails`: each mode's rails, each a list of presets and `at`, the one showing.
- `buttons`: ids from the shelf in order; `"|"` is a thin line between two. An id no shelf has is kept, not drawn, so
  a button that comes back returns to its place.
- `split.share`: how much of the sidebar the top half takes in the split layout.
- `usage`: the presses on the rails, per button, sent by the window once a minute.
- `manage`: `null` until the one ask, then `"asked"`, then their answer.
- A field Sol does not know is kept as it is. A file that cannot be read is put aside as `arrangement.bad-<when>.json`,
  Sol's own shows, and one line says so.

## The one ask

After 100 presses in all, the next chat carries one line from Sol: their rail use so far, and to ask once whether
they want you to keep their rail tidy or keep choosing themselves. Ask it in your own words, once, then write the
answer with `arrange` `do: "manage"`: `agent` (you may tidy it when it helps, and say what you moved) or `me` (you
never move anything unasked).
