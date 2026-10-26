// Claims (#98, docs/how-we-work/PRD.md section 7): Take is the claim, and the paths a branch touches say where it
// stands. Pure functions, no network: which of the six labels a set of paths belongs to (read off .github/CODEOWNERS),
// what each open PR or branch holds, and which of them touch the same places as mine. `sol/brief` carries a small
// copy of the same matching in inline node (it runs where the engine may not be built); this file is the tested home
// of the algorithm, and the two change together.
export const LABELS = ["life", "work", "cowork", "social", "base", "product"];

export type Owners = { pattern: string; label: string }[];
export type ClaimSource = { number?: number; branch: string; author?: string; title?: string; body?: string; paths: string[] };
export type Claim = { branch: string; issue?: number; pr?: number; login: string; paths: string[]; areas: string[] };
export type Overlap = Claim & { shared: string[] };

/** CODEOWNERS read into (pattern, label) pairs: a `# label x:` line opens x's section, each path line's patterns are
 * the tokens before the first @owner. Leading slashes are dropped; a trailing slash means a folder. */
export function owners(codeowners: string): Owners {
  const out: Owners = [];
  let label = "";
  for (const raw of String(codeowners ?? "").split("\n")) {
    const line = raw.trim();
    const head = /^#\s*label\s+([a-z]+)\s*:/i.exec(line);
    if (head) { label = LABELS.includes(head[1].toLowerCase()) ? head[1].toLowerCase() : ""; continue; }
    if (!line || line.startsWith("#") || !label) continue;
    for (const tok of line.split(/\s+/)) { if (tok.startsWith("@")) break; out.push({ pattern: tok.replace(/^\/+/, ""), label }); }
  }
  return out;
}

/** a path matches a pattern: a folder pattern ("sol/engine/") holds everything under it; a plain one ("sol/keep") is
 * that file or a folder of that name */
export function matches(path: string, pattern: string): boolean {
  const p = path.replace(/^\/+/, "");
  if (pattern.endsWith("/")) return p.startsWith(pattern) || p + "/" === pattern;
  return p === pattern || p.startsWith(pattern + "/");
}

/** the one label a path belongs to: the longest matching pattern wins, as in CODEOWNERS itself, so a path under
 * /sol/mac/src/work/ is work, not life */
export function areaOf(path: string, own: Owners): string | undefined {
  let best: { pattern: string; label: string } | undefined;
  for (const o of own) if (matches(path, o.pattern) && (!best || o.pattern.length > best.pattern.length)) best = o;
  return best?.label;
}

/** the labels a set of paths belongs to, in the six labels' order */
export function areasOf(paths: string[], codeowners: string | Owners): string[] {
  const own = typeof codeowners === "string" ? owners(codeowners) : codeowners;
  const hit = new Set(paths.map((p) => areaOf(p, own)).filter(Boolean) as string[]);
  return LABELS.filter((l) => hit.has(l));
}

/** the paths a label owns, as patterns (what a branch with no commits yet is about to touch) */
export function pathsOfLabel(label: string, codeowners: string | Owners): string[] {
  const own = typeof codeowners === "string" ? owners(codeowners) : codeowners;
  return own.filter((o) => o.label === label).map((o) => o.pattern);
}

/** the issue a PR or branch names: "#N" in its title or body, else a branch ending "-N" (Take's names) or a last
 * segment starting "N-" */
export function issueOf(s: Pick<ClaimSource, "branch" | "title" | "body">): number | undefined {
  const ref = /#(\d{1,6})\b/.exec(`${s.title ?? ""}\n${s.body ?? ""}`);
  if (ref) return Number(ref[1]);
  const last = s.branch.split("/").pop() ?? "";
  const m = /-(\d{1,6})$/.exec(last) ?? /^(\d{1,6})-/.exec(last);
  return m ? Number(m[1]) : undefined;
}

const SHARED_BRANCHES = /^(main|stable|live|beta)$|\/(plan|mine|shots)$/;

/** what each open PR, and each branch with no PR yet, holds: its branch, issue, person, paths and labels. The person
 * is the PR's author, else the branch's prefix. Main, stable, live, beta and everyone's plan/mine/shots are nobody's claim. */
export function claimsOf(prs: ClaimSource[], branches: ClaimSource[], codeowners: string | Owners): Claim[] {
  const own = typeof codeowners === "string" ? owners(codeowners) : codeowners;
  const out: Claim[] = [];
  const seen = new Set<string>();
  for (const s of [...prs.map((p) => ({ ...p, isPr: true })), ...branches.map((b) => ({ ...b, isPr: false }))]) {
    if (SHARED_BRANCHES.test(s.branch) || seen.has(s.branch)) continue;
    seen.add(s.branch);
    const issue = issueOf(s);
    const login = (s.author ?? "").replace(/\[bot\]$/i, "") || (s.branch.includes("/") ? s.branch.split("/")[0] : "");
    out.push({
      branch: s.branch, ...(issue ? { issue } : {}), ...(s.isPr && s.number ? { pr: s.number } : {}),
      login, paths: s.paths, areas: areasOf(s.paths, own),
    });
  }
  return out;
}

const dirOf = (p: string) => (p.endsWith("/") ? p.replace(/\/+$/, "") : p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");

/** two paths meet when they are the same file, sit in the same folder (not the repo's top), or one is a folder
 * pattern holding the other */
export function meet(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.endsWith("/") && b.startsWith(a)) return true;
  if (b.endsWith("/") && a.startsWith(b)) return true;
  const da = dirOf(a), db = dirOf(b);
  return !!da && da === db;
}

/** the claims that touch where mine does, each with the paths of theirs that meet mine */
export function overlap(mine: string[], others: Claim[]): Overlap[] {
  const out: Overlap[] = [];
  for (const c of others) {
    const shared = c.paths.filter((p) => mine.some((m) => meet(m, p)));
    if (shared.length) out.push({ ...c, shared });
  }
  return out;
}

/** the claims that change this very file (exact repo-relative match; the folder-level `overlap` is the brief's).
 * Live claims (#202): the harness asks this on every edit, in inline node, a copy of these lines. */
export function fileOverlap(path: string, claims: Claim[]): Overlap[] {
  const p = path.replace(/^\/+/, "");
  if (!p) return [];
  return claims.filter((c) => c.paths.includes(p)).map((c) => ({ ...c, shared: [p] }));
}

/** the one line the editing agent reads on a hit: a PR to read and build on, or a side copy on this machine. Never a
 * refusal. The harness carries the same words (sol/harness/guard, claimLine); the two change together. */
export function claimLine(path: string, c: Pick<Claim, "branch" | "login" | "pr">): string {
  return c.pr
    ? `claim: ${path} is also changed on #${c.pr} (${c.login}, ${c.branch}): read it (gh pr diff ${c.pr} -- ${path}) and build on it, or say in your PR how yours differs.`
    : `claim: ${path} is also being changed on ${c.branch} (${c.login}, a side copy on this machine): build on it or say so in your PR.`;
}
