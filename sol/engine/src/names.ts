// Names (#253): "them" becomes "Frank" the moment the talk gives it away. After
// each final turn: one clear address in a `you` turn ("thanks Frank", "Frank, can you send it", "hi Frank") or one
// clear introduction in a `them` turn ("hi, it's Frank", "Isaac here", "this is Frank", "my name is Frank") names
// `them` at once. A bare capitalised word (no address, no introduction, not at a sentence's start, not on the stop
// list) names `them` only when Marco has said it twice. `you` is never renamed by the talk, only by a click; a click
// is never overridden by the talk, and a clear name is never overridden by a guess. One voice per side is assumed.
//
// Pure: nothing here reads or writes; `nameFrom` keeps its counts in the state it is given.

export type NameSide = "you" | "them";
export type NameBy = "talk" | "click";
/** how sure the side's name is: a guess from a bare word, a clear address or introduction, or a person's click */
type Sure = "none" | "bare" | "clear" | "click";
export type NameState = { you: string; them: string; sure: Sure; counts: Map<string, number> };

export const freshNames = (): NameState => ({ you: "you", them: "them", sure: "none", counts: new Map() });

/** a click on a side's name: it sticks for the whole talk */
export function nameByClick(s: NameState, who: NameSide, name: string) {
  if (who === "you") s.you = name; else { s.them = name; s.sure = "click"; }
}
/** a learned name, applied (the engine applies what nameFrom returns) */
export function nameByTalk(s: NameState, name: string, clear: boolean) {
  s.them = name; s.sure = clear ? "clear" : "bare";
}

// words that are capitalised and still no one's name: days, months, the start of a sentence, the usual fillers, the
// apps and places a call is full of
const STOP = new Set([
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "today", "tomorrow", "yesterday", "tonight",
  "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december",
  "thanks", "thank", "fine", "sure", "ok", "okay", "yes", "yeah", "yep", "no", "nope", "hi", "hey", "hello", "bye", "goodbye",
  "cheers", "sorry", "please", "well", "so", "and", "but", "or", "then", "right", "great", "good", "nice", "cool", "perfect",
  "alright", "morning", "afternoon", "evening", "night", "everyone", "everybody", "all", "guys", "folks", "team", "sir",
  "madam", "mom", "mum", "dad", "god", "man", "dude", "mate", "buddy", "friend", "here", "there", "over", "just", "now",
  "what", "when", "where", "who", "why", "how", "can", "could", "would", "will", "do", "did", "is", "are", "was", "the",
  "a", "an", "this", "that", "it", "its", "i", "i'm", "i'll", "i've", "i'd", "we", "you", "they", "he", "she", "my",
  "our", "your", "let's", "maybe", "actually", "honestly", "anyway", "exactly", "totally", "absolutely", "nothing",
  "something", "anything", "someone", "anyone", "nobody", "somebody", "see", "talk", "speak", "speaking", "wait", "listen",
  "look", "sol", "marco", "mac", "macbook", "iphone", "zoom", "teams", "meet", "google", "slack", "discord", "facetime",
  "whatsapp", "github", "apple", "microsoft", "excel", "word", "english", "dutch", "chinese", "french", "german", "spanish",
  "europe", "america", "china", "amsterdam", "london", "christmas", "easter", "covid", "ai", "ceo", "pm", "am", "q",
]);
const NAME = "(\\p{Lu}[\\p{Ll}'’-]+(?:\\s\\p{Lu}[\\p{Ll}'’-]+)?)";
const isName = (w: string, s: NameState) =>
  w.length >= 2 && !STOP.has(w.toLowerCase()) && !STOP.has(w.split(/\s/)[0].toLowerCase()) && w.toLowerCase() !== s.you.toLowerCase();
/** a two-word match keeps its second word only when that one is a name too ("Frank Lee", not "Frank Can") */
const trimName = (w: string, s: NameState) => {
  const [a, b] = w.split(/\s/);
  return b && isName(b, s) && !/^(?:can|could|would|will|do|did|are|have|here|please|so|and|but)$/i.test(b) ? `${a} ${b}` : a;
};

// a `you` turn addressing the other side
const ADDRESS_BEFORE = new RegExp(`(?:^|[\\s,.!?])(?:[Tt]hanks|[Tt]hank you|[Hh]i|[Hh]ey|[Hh]ello|[Bb]ye|[Gg]oodbye|[Oo]k|[Oo]kay|[Cc]heers|[Ss]orry|[Mm]orning|[Ss]ee you|[Tt]alk soon)[,]?\\s+${NAME}(?=$|[\\s,.!?;:])`, "u");
const ADDRESS_START = new RegExp(`(?:^|[.!?]\\s+)${NAME},\\s+(?:can|could|would|will|do|did|are|have|what|when|where|how|why|is|i|you|we|let's|just|please|so|listen|look|quick)\\b`, "iu");
// a `them` turn introducing itself
const INTRO = new RegExp(`(?:^|[\\s,.!?])(?:[Ii]t's|[Ii]t is|[Tt]his is|[Ii]'m|[Ii] am|[Mm]y name is|[Mm]y name's|[Cc]all me)\\s+${NAME}(?=$|[\\s,.!?;:])`, "u");
const HERE = new RegExp(`(?:^|[\\s,.!?])${NAME}\\s+here(?=$|[,.!?;:]|\\s+(?:from|speaking|again))`, "u");
// ADDRESS_START uses the i flag for its tail; its name must still be capitalised in the text
const capital = (w: string) => /^\p{Lu}/u.test(w);

/** the clear name in a turn, if any (pure) */
function clearName(turn: { who: NameSide; text: string }, s: NameState): string | null {
  const t = turn.text.trim();
  const tries = turn.who === "you" ? [ADDRESS_BEFORE, ADDRESS_START] : [INTRO, HERE];
  for (const re of tries) {
    const m = re.exec(t);
    if (!m || !capital(m[1])) continue;
    const name = trimName(m[1], s);
    if (isName(name, s)) return name;
  }
  return null;
}

/** the capitalised words of a turn that are not at a sentence's start and not on the stop list (pure) */
export function bareNames(text: string, s: NameState = freshNames()): string[] {
  const out: string[] = [];
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    const ws = sentence.split(/\s+/).filter(Boolean);
    for (let i = 1; i < ws.length; i++) {
      const w = ws[i].replace(/^[^\p{L}]+|[^\p{L}'’-]+$/gu, "").replace(/['’]s$/, "");
      if (/^\p{Lu}[\p{Ll}'’-]+$/u.test(w) && isName(w, s)) out.push(w);
    }
  }
  return out;
}

/** after a final turn: the side it names and the name, or null. Never names `you`; never over a click; a clear address
 *  or introduction names at once, a bare word when Marco has said it twice (the counts are kept in `s`) (pure) */
export function nameFrom(turn: { who: NameSide; text: string }, s: NameState): { who: "them"; name: string; clear: boolean } | null {
  if (s.sure === "click") return null;
  const clear = clearName(turn, s);
  if (clear) return s.sure === "clear" ? null : { who: "them", name: clear, clear: true };   // the first clear name stays
  if (turn.who !== "you" || s.sure !== "none") return null;
  for (const w of bareNames(turn.text, s)) {
    const n = (s.counts.get(w) ?? 0) + 1;
    s.counts.set(w, n);
    if (n >= 2) return { who: "them", name: w, clear: false };
  }
  return null;
}
