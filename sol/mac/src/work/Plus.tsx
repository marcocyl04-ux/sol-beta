import { useRef, useState } from "react";
import { Menu, type MenuItem } from "./Menu";

// The box's + (#24 round two: the same box everywhere). Every talk can attach files; a session adds what Claude Code
// has (mention, a command, a skill, ask on the side) after it. A chat's + is attach alone, so it opens the picker at once.
export function Plus({ more, onFiles }: { more?: MenuItem[]; onFiles: (fs: File[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const pick = () => input.current?.click();
  const items: MenuItem[] = [{ label: "attach files", run: pick }, ...(more ?? [])];
  return (<>
    <button type="button" className="wplus" title={more?.length ? "attach, mention, a command" : "attach files"}
      onClick={(ev) => { if (!more?.length) return pick(); const r = ev.currentTarget.getBoundingClientRect(); setMenu({ x: r.left, y: r.top - 6 }); }}>+</button>
    <input ref={input} type="file" multiple hidden onChange={(ev) => { const fs = Array.from(ev.target.files ?? []); ev.target.value = ""; if (fs.length) onFiles(fs); }} />
    {menu && <Menu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} />}
  </>);
}
