# The look: Sol, and the goo

Sol's mark is Marco's flat splat (`sol/design/sol.svg`; `mac/src/Sol.tsx` draws it inline, breathes, blinks, follows
the pointer, squashes on a click). Since 2026-10-27 every small thing that shows a state is **goo**, drawn from one
kit, `mac/src/creature/goo.tsx`. Read this before touching a mark, a pill, a knob or a badge, and keep to it: a new
state never brings a colour or a shape of its own.

## The rules

- **Six colours, one job each**, all siblings of the brand's pink, orange, yellow and lime (`JOBS`): **brand** (Sol
  himself, the current thing), **shore** (ambient: anything alive but meaning nothing yet; it varies a little per seed,
  `shoreVar`), **spring** (done), **ember** (failed, unplugged), **sun** (needs you), **stone** (off, down). A state is
  said with one of these, never with a colour of its own.
- **Nothing is one flat colour.** Every body is a banded gradient (`Bands`, or `bandsCss` for a CSS box) lit from the
  top left and shaded below (`Light`).
- **Bodies bridge.** Near things merge through the goo filter (`Goo`): a drop leaving Sol keeps a neck until it lets
  go, a value buds up out of a knob, friends bud out of Sol. Use the filter with `filterUnits="userSpaceOnUse"` and a
  region larger than the drawing, or thin strokes get clipped.
- **The two square eyes** (black, white) are the signature of presence: open while something is here, half shut
  while it starts, shut when it is down. Nothing else gets eyes.
- **Motion is simple**: SMIL or a spring (`mac/src/motion.ts`), a squash on landing, no easing fireworks. Under
  `prefers-reduced-motion` everything shows its rest frame and stands still (`reduced`).
- **Words over goo** are white with a dark halo; the heat calms under a word so it reads.

## The pieces, and where each lives

| what | where | notes |
|---|---|---|
| the daily mark: running, done, failed, needs you | `creature/goo.tsx Droplet`; `creature/indicators.tsx Runner, CellCheck` | a turning drop; a smooth check or a sagging bar drawn out of the drop when it lands (`land`); a halo |
| the engine: eyes on a pill, in the chat bar | `creature/indicators.tsx Status` | up, starting, down; a spring wash on ok; squashes on a click |
| effort as heat, a droplet knob on a track of dots | `mac/src/EffortPill.tsx` | more and faster heat per level; pours in on a change; the track stays open until the pointer leaves |
| the Bypass sheen | `creature/indicators.tsx Aurora` | the shore's bands drifting through the mode chip |
| the permission wheel | `mac/src/work/LeashWheel.tsx` | click, hold or right-click the mode chip: a dome of dark goo, one drop per mode, Sol in the current one; Bypass asks once |
| the Settings sliders | `creature/indicators.tsx CellRange` | liquid in a dry channel of dots; the value buds up while held |
| voice | `creature/Voice.tsx VoiceBody, VoiceRibbon` | the call badge is Sol breathing rings out (speaking) or in (listening); the mic a liquid ribbon |
| the seat: Sol over the mode pill | `mac/src/SeatScene.tsx`, `ModeWheel.tsx`, `SeatSwitch.tsx useBridgeThumb` | Sol plain at home; on cowork two friends bud out of him; the pill's capsule stretches across |
| people | `creature/goo.tsx Bud, FAMILIES, familyOf`; `cowork/Person.tsx` | each person's agent wears a bud in their family, by name; yours is Sol |

Untouched on purpose: the notch (its crew and bead are still the cell map, `mac/src/Mark.tsx`) until it is redrawn
as its own space.

## Checking a change

- `mac/gallery.html` on the scratch Vite shows every piece large and at size (`src/gallery.tsx`; add a `<Section>` for
  anything new). Shoot it headless and look, every time.
- The atlas, `mine/look/ATLAS.html` on Marco's branch `marco/mine` (not on main), is a still of every surface of the
  face; a commit there that touches `mac/src` refreshes it (`mine/look/atlas-shot.mjs`). If a still there is not what
  the face does, the face or the still is wrong.
- The direction the pieces come from, with the reasons: `mine/look/DIRECTION-4.html` on `marco/mine` (and 1 to 3
  before it).
