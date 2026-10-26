// An edit, drawn as the lines it took out and put in. A small LCS over lines (edits are small; a huge one falls back
// to all-out, all-in). Long runs of unchanged lines fold to "⋯ n lines", two kept on each side of a change.
export type DL = { t: " " | "-" | "+" | "~"; s: string };

export function lineDiff(a: string, b: string): DL[] {
  const A = a.split("\n"), B = b.split("\n");
  const n = A.length, m = B.length;
  if (n * m > 250_000) return [...A.map((s) => ({ t: "-" as const, s })), ...B.map((s) => ({ t: "+" as const, s }))];
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out: DL[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { out.push({ t: " ", s: A[i] }); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) out.push({ t: "-", s: A[i++] });
    else out.push({ t: "+", s: B[j++] });
  }
  while (i < n) out.push({ t: "-", s: A[i++] });
  while (j < m) out.push({ t: "+", s: B[j++] });
  return out;
}

// the diff a tool call makes, or null for a tool that changes no file
// remembered by the call's input (an item's input object is kept across renders): the LCS ran again for every edit row
// on every render of the talk, and a busy talk renders on every delta (2026-10-25, SMOOTH.md)
const diffs = new WeakMap<object, DL[] | null>();
export function editDiff(name: string, input: any): DL[] | null {
  if (!input || typeof input !== "object") return null;
  if (diffs.has(input)) return diffs.get(input)!;
  const d = editDiffNow(name, input);
  diffs.set(input, d);
  return d;
}
function editDiffNow(name: string, input: any): DL[] | null {
  if (name === "Edit") return lineDiff(String(input.old_string ?? ""), String(input.new_string ?? ""));
  if (name === "MultiEdit" && Array.isArray(input.edits))
    return input.edits.flatMap((e: any, k: number) => [...(k ? [{ t: "~" as const, s: "" }] : []), ...lineDiff(String(e.old_string ?? ""), String(e.new_string ?? ""))]);
  if (name === "Write") return String(input.content ?? "").split("\n").map((s) => ({ t: "+" as const, s }));
  return null;
}

export const diffStat = (d: DL[]) => ({ add: d.filter((l) => l.t === "+").length, del: d.filter((l) => l.t === "-").length });

function fold(d: DL[], keep = 2): (DL | { gap: number })[] {
  const near = d.map((l, i) => l.t !== " " || d.slice(Math.max(0, i - keep), i + keep + 1).some((x) => x.t !== " "));
  const out: (DL | { gap: number })[] = [];
  for (let i = 0; i < d.length; i++) {
    if (near[i]) { out.push(d[i]); continue; }
    let k = i;
    while (k < d.length && !near[k]) k++;
    out.push({ gap: k - i });
    i = k - 1;
  }
  return out;
}

export function Diff({ d, max = 400 }: { d: DL[]; max?: number }) {
  const rows = fold(d).slice(0, max);
  return (
    <div className="wdiff">
      {rows.map((r, i) => "gap" in r
        ? <div key={i} className="dl gap">⋯ {r.gap} line{r.gap > 1 ? "s" : ""}</div>
        : r.t === "~" ? <div key={i} className="dl gap">⋯</div>
        : <div key={i} className={`dl ${r.t === "+" ? "add" : r.t === "-" ? "del" : ""}`}><i>{r.t}</i><span>{r.s || " "}</span></div>)}
    </div>
  );
}
