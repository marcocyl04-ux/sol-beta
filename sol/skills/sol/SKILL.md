---
name: sol
description: Use when changing how Sol looks or works for this person - buttons, rails, presets, the sidebar's layout, modes, or making them a button of their own; the marks, pills and knobs that show a state (the goo, look.md); and showing how a part of Sol works through its map. Not for building Sol itself (see CONTRIBUTING.md).
---

# Sol, made theirs

Sol is one window for all of a person's AI: the seats (Claude Code, Codex) sit in it, and its modes are Home (chats and
sessions in folders) and Cowork (the team). Along the top of each mode runs a rail of buttons. What sits on it, and
how the sidebar is laid out, is the person's own, and you change it for them when they ask. They never need to see a
file path.

## What you can change, and how

| They want | You do |
|---|---|
| a button on or off a rail, moved, a preset made, renamed, deleted or shown | the `arrange` tool (`arrangement.md`) |
| the sidebar plain, split or carousel | `arrange` with `do: "layout"` |
| a button of their own | write `sol/home/buttons/my-<id>.tsx` (`buttons.md`), run the check, then `arrange` to put it on a rail if they asked |
| a mode of their own | `arrange` with `do: "set"` and a patch to `modes` and `rails`; there is no screen for it |
| a mark, a pill, a knob or a badge that shows a state | the goo kit, `look.md`: one of the six jobs, a banded body, the gallery to check |

**Read here, write there.** Sol's own code is read-only to you. You write only in `sol/home/buttons/` and through
`arrange`. Both are the person's, never committed, and a new version of Sol never touches them. In a chat your folder
is `sol/home` itself, so the buttons are `buttons/` and the check is `../buttons/check`.

**Ask Sol, don't remember.** Before a change, `arrange` with `do: "get"`: the rails, the presets, every button on the
shelf with its line, the presses so far, and who tidies the rail. This skill keeps no list of buttons on purpose.

**Every change ends with a look.** After a button, run the check; after any change, `get` again and see it there.

## The words

Sol's words are defined in `GLOSSARY.md` at the top of the repo. The ones you will use:

- **button**: one thing with a special function (the desk, the terminal, changes). One file each.
- **rail**: the row of buttons at the top of a mode. It shows one preset at a time.
- **preset**: a named set of up to 10 buttons. Scroll over the rail to change it. Sol ships Everyday, Build and Team.
- **shelf**: every button there is, Sol's and theirs ("Yours"), each with its line. The ⋮ at the end of a rail opens it.
- **layout**: the sidebar's shape: plain, split or carousel.
- **arrangement**: one person's rails, presets, layout and presses, in one file of their own.
- **chat**: a talk in no folder. A **session** is a talk in a folder.
- **Home**, **Cowork**: the modes.

Avoid: module, widget, template or setup (for a preset), loose (for a chat), Life and Work (for Home).

**Own words.** People name things their own way. Keep a map of theirs in `sol/home/memory/words.md`, one line each
(`my "dock" = the rail`), never committed. Speak in their word or Sol's, whichever they understand. When their words
get muddled, offer once to settle on one word per thing.

## The design rules

Every button keeps these, and `sol/buttons/check` names the one it breaks. Each has a reason:

- **glyph**: 14 px of ink (`Ink`, or an svg 14 by 14), or at most two short words. The rail reads as one quiet line.
- **colour**: no colour of its own. Sol is black, white and pearl; a state is said in one of the six jobs of the goo
  (`look.md`: brand, shore, spring, ember, sun, stone), never in a colour the button brings.
- **frame**: a pane lives in the pane frame: no fixed position, no portal, no window of its own. So two buttons never
  sit on top of each other.
- **over**: nothing draws over the bar, the composer or the creature: no z-index, no reaching into Sol's page.
- **network**: no network of its own. What reaches out goes through the engine, which knows what the seat may do.
- **press**: a press that waits says so (`flash`), so a slow one is never a dead button.
- **says**: one line, 12 to 120 letters, saying what it is for in words a person would use.

The look under everything (since 2026-10-26, `sol/README.md` "The look: the glass"; the marks since 2026-10-27, "The
look: Sol, and the goo", the rules in `look.md`): the window is one base colour at
an opacity over the desktop, and every surface, line and word is a step of it, named in `face.css` and derived in
`look.ts`. A thing you add stands on a step (`--surface`, `--raised`, `--island`; anything that opens over the chat on
`--pop`) and speaks in `--ink`, `--dim` or `--mute`; it never brings a colour, an opacity or a blur of its own, so it
still looks right when the person turns the opacity or the base colour in Settings → Look. The talk's column is
`--col-max` and `--col-pad`; stand in it, do not make a second margin.

An expert can bypass a design rule by naming it in the file: `// bypass: colour, because a stoplight is red and green`.
The check then passes it and the shelf marks it "bypassed". `type`, `id` and `fields` cannot be bypassed: without
them Sol cannot draw the button.

## Making them a button

1. **A mockup first**: a picture of the rail with the new glyph, and what the pane will show. Skip it only for an
   expert, or when they have said "skip the mockups" (keep that in `sol/home/memory/`).
2. **The file**: `sol/home/buttons/my-<id>.tsx`, against the contract in `buttons.md`. Write its `says` in Sol's voice,
   not a manual's, and fill in `made` (today, and the title of this talk).
3. **The check**: `bash sol/buttons/check sol/home/buttons/my-<id>.tsx`. A fail names the rule; fix it, or bypass it
   with a reason if they want it that way.
4. **It appears under Yours** on the shelf (live, on Sol's hot window). Put it on a rail with `arrange` if they asked.

## The notch and a talk

Anticipate (the ear pill on the notch's quiet card) hears a call on the Mac and helps in the moment: a drawer under the
notch with the Transcript, the Cards Sol volunteered and the Ask thread; 🌐 (fn) held is "speak to Sol" with the call
muted through the call app's own shortcut; Stop packs the talk up into **Conversations** (Home's menu, above settings,
⌘;), where the person reviews it slowly. Words are kept in `sol/home/voice/talks/`, audio never. The review is read
by Gemini flash, by the Claude card seat when Gemini fails (the free quota runs out at twenty a day), and a page never
shows a raw error: one plain sentence, "Sol could not review this talk yet: …". Sol talking (the call) is the **voice** setting; `off`
means Sol listens and writes and no call starts from any face, with one plain why. Anticipate and dictation need no voice.

What the person can change is one file, theirs, never committed: **`sol/home/skills/notch.md`**, written once by Sol
with its defaults. Read it before changing it, change only the heading they asked about, and tell them it takes effect
at the next talk's start:

| They want | You do |
|---|---|
| Sol quieter on a subject ("never on family") | a `Never on:` line under **Anticipate** |
| a fifth button in the drawer ("Translate: say it in Chinese, short") | one `Name: prompt` line under **Buttons**; five at most, the rest are ignored |
| the mute to work in another call app | one `App name: cmd shift m` line under **Mute**, the app's name as macOS shows it |
| more or fewer questions after a talk, or what never goes to memory | the lines under **After a talk** |

A talk's review, names and answers are edited in Conversations itself (a click on a name renames; Keep, To the shelf,
Delete are its buttons); never edit a talk file by hand. The spec is issue #253, the map
`sol/design/maps/notch.html`.

## Maps, and comments on a page

A visual part of Sol (the sidebar, the modes, the rails and buttons, the notch, the desk, the composer, the panes) has
a map: one page of diagrams in `sol/design/maps/<part>.html`, drawn in Sol's colours. It shows where the part's data
comes from, what in it is real and what is only how it looks, its states, and its layouts. People work on a part far
more easily by looking at it than by reading about it (#179).

- **Anything made for a person to look at goes in the page pane, never the browser tab.** A mockup, a review page, a
  board, a sheet of stills: write the HTML file with the Write or Edit tool and the pane opens it; they annotate it there
  (a point, words, a box, each with a comment). The browser tab is for the web; it refuses a local page.
- **Before working on a part with them, show its map.** The page pane lists the pages this talk wrote, so open it by
  touching the file (an Edit, even a small one). If the part has no map yet, draw one the first time, in the same look as
  `sidebar.html`.
- **Keep it true.** A change to how a part looks or behaves updates its map in the same PR. The `<!-- covers: ... -->`
  line at the top of each map names the files it is drawn from.
- **Their comments reach you only when they send them.** In the page pane, pins stay on the page until "to the box"
  (⌘↵) puts them in the message box, and they arrive with the next message they send, as "Comments on the page ...". If
  they say they commented and nothing came, ask them to press ⌘↵ and then send.

## Keeping this skill true

- It points at live state (the tool, the files, the check) rather than copying it. When unsure, read the code:
  `sol/mac/src/buttons/types.ts`, `sol/engine/src/arrange.ts`, `sol/buttons/check.mjs`.
- Whoever changes the button contract, the arrangement or the check updates this skill in the same PR.
- If this skill and the code disagree, the code wins: do it the code's way, and fix the skill.
- A person's agent may keep its own copy, done its own way; `sol/setup` leaves one alone.
