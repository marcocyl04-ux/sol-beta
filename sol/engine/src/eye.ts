// The eye, as the engine knows it (#253). The eye itself is the app's: a
// press on the notch hides every Sol window from a screen share at once (src-tauri/src/eye.rs), with no engine in the
// way. A hidden window is blank to `screencapture -l`, so a Sol grab or File it's shot taken meanwhile would be a black
// picture on the shelf or the tracker. The notch tells the engine after every flick and on every connect
// (`{ type: "eye", invisible }`, PROTOCOL.md round 52); grab.ts and team/file.ts ask `solHidden()` and refuse with
// HIDDEN. Shot and Page photograph other apps and are not touched.
//
// One flag for this engine: the Mac's own engine is the one that takes pictures (grab.* and team.file.shot go there).
// An engine starts thinking Sol is visible, the app's own default; the notch's next connect corrects it.

/** the words a refused grab answers with, shown as they are on the card and in the sheet */
export const HIDDEN = "Sol is hidden: open the eye to grab it";

let hidden = false;

/** the notch's word: true while Sol's windows are hidden from a share */
export function setSolHidden(on: unknown): void { hidden = on === true; }
export function solHidden(): boolean { return hidden; }
