// Rooms (#154): the face's few rules about rooms, kept in one place for Cowork's side and Control's list. A new room is
// made by the engine from its name alone (#160, team/rooms.ts makeRoom), so the face no longer builds one.

/** a code as typed or pasted (#157): upper-cased, anything but letters and digits dropped ("k7q x2m" is K7QX2M), six at most */
export const codeTyped = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 6);

/** where a room meets, in words: the hub's host, or "this Mac" when it meets on this Sol's own */
export const meets = (hub: string) => (hub ? hub.replace(/^wss?:\/\//, "").replace(/[/?#].*$/, "") : "this Mac");
