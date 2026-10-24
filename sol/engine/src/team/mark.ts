// Felt or silent, and the test note (#100, docs/how-we-work/PRD.md sections 5 and 8): every draft PR says what to try
// ("What to try: ..." or the template's **What to try** section) and whether a person can notice it, "Felt or silent:
// felt|silent". A person flips it with a comment whose first word is **felt** or **silent**; the latest such comment
// wins over the body. For a felt PR the lead runs it on their Sol (Try) before marking it ready; a silent one is marked
// ready without a run. Pure: board.ts reads the bodies and comments, the face posts the flip (wire.ts team.pr.mark).
export type Mark = "felt" | "silent" | "";
export type TestNote = { whatToTry: string; mark: Mark; flippedBy?: string };
export type PrComment = { author: string; body: string; at?: string };

// a line that starts another part of the body: a bold head, a markdown heading, or the felt-or-silent line
const NEXT = /^\s*(?:\*\*[^*\n]+\*\*|#{1,6}\s|felt or silent\b|🤖)/iu;
// the template's own hint right after a head, "(for the person who will try it: ...)", is not the note
const HINT = /^[ \t]*\([^)]*\)/;

/** the part of a body after a head ("What to try:" or "**What to try**"), up to the next head (pure) */
function section(body: string, head: RegExp): string | null {
  const m = head.exec(body);
  if (!m) return null;
  const rest = body.slice(m.index + m[0].length).replace(HINT, "").replace(/^[ \t]*:?[ \t]*/, "");
  const lines = rest.split("\n");
  const out: string[] = [];
  for (const [i, l] of lines.entries()) {
    if (i > 0 && NEXT.test(l)) break;
    out.push(l);
  }
  return out.join("\n").trim();
}

/** a flip comment: its first word is **felt** or **silent** (pure) */
export function flipOf(body: string): Mark {
  const m = /^\s*\*\*(felt|silent)\*\*/i.exec(String(body ?? ""));
  return m ? (m[1].toLowerCase() as Mark) : "";
}

/** who flipped it: the comment's author, or "<login>'s agent" when it is signed by an agent (pure) */
const flipper = (c: PrComment) => {
  const agent = /\[bot\]$/i.test(c.author) || /—\s*[A-Za-z0-9-]+'s agent\s*$/.test(c.body.trim());
  const login = c.author.replace(/\[bot\]$/i, "");
  return agent ? `${login}'s agent` : login;
};

/** the test note of a PR: what to try, felt or silent, and who flipped it last (pure; comments oldest first) */
export function testNote(body: string, comments: PrComment[] = []): TestNote {
  const b = String(body ?? "").replace(/\r\n?/g, "\n");
  const whatToTry = (section(b, /(?:^|\n)[ \t]*(?:\*\*)?what to try(?:\*\*)?/i) ?? "").slice(0, 2000);
  const said = /(?:^|\n)[ \t]*(?:\*\*)?felt or silent(?:\*\*)?[ \t]*(?:\([^)]*\))?\s*:?\s*(?:\*\*)?(felt|silent)\b/i.exec(b);
  let mark: Mark = said ? (said[1].toLowerCase() as Mark) : "";
  let flippedBy: string | undefined;
  for (const c of comments) {
    const f = flipOf(c.body);
    if (f) { mark = f; flippedBy = flipper(c); }
  }
  return { whatToTry, mark, ...(flippedBy ? { flippedBy } : {}) };
}

/** the comment a flip posts: the word first, then what it means for the person, signed (pure) */
export function flipBody(mark: "felt" | "silent", sig: string): string {
  const means = mark === "felt" ? "a person runs it on their Sol before it is marked ready" : "nobody can notice it, so it is marked ready without a run";
  return `**${mark}**: ${means}.\n\n— ${sig}`;
}
