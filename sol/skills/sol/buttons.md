# Buttons

A button is one file exporting one `ButtonDef`. Sol's own are in `sol/mac/src/buttons/`; a person's own are
`sol/home/buttons/my-<id>.tsx`. The contract is `sol/mac/src/buttons/types.ts`: read it when this page and it differ.

## The contract

| field | | what it is |
|---|---|---|
| `id` | must | its file's name: `my-date` for `my-date.tsx`. Small letters and dashes, starting `my-` |
| `name` | must | what the shelf, the pane's tab and the hover say: `"date"` |
| `glyph` | must | an `Ink` drawing (14 px), an svg 14 by 14, or one or two words (`"file it"`) |
| `says` | must | one line, 12 to 120 letters: what it is for, in a voice that makes you want to try it |
| `meant` | must | the modes it was made for: `["home"]`, `["cowork"]`, `["home", "cowork"]` (`"social"` too). It may still go anywhere |
| `kind` | must | `"pane"` opens on the right in the pane frame; `"press"` does a thing |
| `Pane` | pane | `(c: ButtonCtx) => ReactNode`, drawn as a component |
| `press` | press | `(c: ButtonCtx) => void` |
| `shows` | | `(c) => boolean`: hidden where it means nothing; always shown when left out |
| `badge` | | `(c) => ReactNode`, drawn in the glyph's place (a count, a state) |
| `key` | | a keyboard shortcut, written as Sol writes them: `"⌘⇧D"` |
| `kept` | | `true`: the pane stays mounted while its tab is open (a shell, a draft) |
| `look` | | `(c) => string`: its cell's classes on the bar, for one whose look is its own |
| `hover` | | `(c) => string`: a hover that says something live; `says` when left out |
| `tab` | | the pane's tab, where it is not the name |
| `on` | | `(c) => boolean`: a press that is a switch, lit while on |
| `useOff` | | a hook, `() => boolean`: true while it cannot be pressed |
| `made` | | yours: `{ at: "2026-10-22", from: "<the talk's title>" }`, shown on the shelf's hover |
| `bypassed` | never | set by Sol's loader from the file's `// bypass:` lines; never write it |

`ButtonCtx`, what `Pane`, `press` and the others are handed: `mode`, `session?`, `cwd?`, `e` (the engine: `e.busy`,
`e.say`, `e.desk` and the rest of `useEngine`), `w?` (a session's work), `open(id)` (show a pane by its button's id),
`flash(line)` (one line to the person), `mark`, `armed` and `setArmed` (the browser's marking), `shell?` (an open
session's state), `team?`, and `talk?` (put a talk on the stage). Their shapes are in `types.ts`.

## How a file of theirs reaches the shelf

- The check, `bash sol/buttons/check <file>` (no file: every one in `sol/home/buttons`), type-checks it against
  `ButtonDef` (an `as ButtonDef` is not believed) and holds it to the design rules in `SKILL.md`. Each failure names
  its rule and line. `--test` runs the check's own fixtures and all of Sol's buttons.
- Sol's window loads each file on its own. One that does not load, has the wrong id, takes the id of one of Sol's,
  or lacks a field is left off with one line on the shelf; the rest of Sol goes on. A pane or glyph that throws shows
  one plain line in its place.
- It shows on the shelf under "Yours", with its line, and on hover when and where it was made.

Imports are relative to `sol/home/buttons/`: the types and `Ink` are `../../mac/src/buttons/`. React is Sol's own.

## A pane

```tsx
import { Ink } from "../../mac/src/buttons/Ink";
import type { ButtonDef } from "../../mac/src/buttons/types";

export default {
  id: "my-date", name: "date", kind: "pane", meant: ["home"],
  says: "today's date, big enough to read across the room",
  glyph: <Ink><rect x="2" y="3" width="10" height="9" rx="1.5" /><path d="M2 6h10M5 1.5v3M9 1.5v3" /></Ink>,
  made: { at: "2026-10-22", from: "econ essay" },
  Pane: () => <p style={{ margin: 24, fontSize: 28, color: "var(--ink)" }}>{new Date().toDateString()}</p>,
} satisfies ButtonDef;
```

## A press

```tsx
import type { ButtonDef } from "../../mac/src/buttons/types";

export default {
  id: "my-copy-date", name: "copy date", kind: "press", meant: ["home"],
  says: "today's date on your clipboard, ready for the top of a page",
  glyph: "date",
  made: { at: "2026-10-22", from: "econ essay" },
  press: ({ flash }) => { navigator.clipboard.writeText(new Date().toDateString()).then(() => flash("today's date is copied")); },
} satisfies ButtonDef;
```

It waits on the clipboard, so it says when it is done (`flash`); without that the check fails it on `press`.
Colours are Sol's own tokens only: `var(--ink)`, `var(--paper)`, `var(--mute)`, `var(--line)` and the like.
