// One home on two machines: a path made on the Mac starts /Users/<x>, one made on the NucBox /home/<x>. Records
// cross over Syncthing with the path of the machine that wrote them (One Sol, #62), so anything that compares a
// recorded path to this machine's folders goes through here first.
export type Machine = "mac" | "nucbox";

const HOME = /^\/(Users|home)\/[^/]+(?=\/|$)/;

// whether a path sits in some machine's home, and which machine that is
export const inHome = (p: string) => HOME.test(p);
export const machineOf = (p: string): Machine | undefined => { const m = HOME.exec(p); return m ? (m[1] === "Users" ? "mac" : "nucbox") : undefined; };

// the same folder under another home
export const twinIn = (p: string, home: string) => (HOME.test(p) ? home + p.replace(HOME, "") : p);
