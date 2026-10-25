// The room's record (#152, docs/room-provider/FOUNDATION.md): where a card, a note, a plan and a login live. Cowork keeps
// nothing of its own; what it reads and writes outside this machine is one of six verbs, and this file is their one
// interface: who I am, who is in, the cards, the notes on a card, the files, what changed. A seventh group, code, is
// what only a code room has (branches, a PR made ready, compare, commit statuses, head refs, a remark on a PR's line).
// The live word (presence, chat, show, pings, hands) rides the relay and is not part of it.
//
// GitHub is the first provider, record/github.ts: the gh calls that lived in each team/ file, moved there as they
// were, grouped by verb. A module that takes `gh` as a dep (the tests fake it) builds its record from that runner with
// makeGithubRecord(gh); everything else asks record(). For now record() always answers GitHub; a room's `provider`
// (team.json's rooms, #154) is what will pick the file once Drive exists. The answers are still what gh prints (text,
// or GitHub's JSON where the caller parsed it at once), so the move changed no behaviour; a second provider (Drive)
// gives each verb its own shape when it comes.
import { makeGithubRecord, runGh } from "./record/github.js";

/** gh, or a test's fake of it: its output, or a throw on a non-zero exit */
export type Gh = (args: string[], cwd?: string) => Promise<string>;
/** gh whose output is bytes (an image, a page) */
export type GhBytes = (args: string[]) => Promise<Buffer>;
/** gh with a token in its env (never on its command line): its output, or a throw on a non-zero exit */
export type GhAs = (args: string[], token: string) => Promise<string>;
/** gh with a JSON body on --input (a shot is too big for an argument) */
export type GhInput = (args: string[], body: object) => Promise<string>;

/** one write of a file: its new content (base64), the branch, the message, the version it replaces when there is one */
export type FileWrite = { message: string; branch: string; content: string; sha?: string };
/** the last commit on a path, as the provider says it */
export type LastCommit = { committedDate?: string; message?: string; author?: { name?: string; email?: string; user?: { login?: string } } };

export interface RoomRecord {
  /** me, as the provider knows me */
  who: {
    login(): Promise<string>;                           // my login (as printed)
    me(): Promise<string>;                              // my login and name, as JSON text
    loginAs(token: string): Promise<string>;            // who this token is (the hub's question)
    token(): Promise<string>;                           // my token for one connect, "" when not signed in; never kept
    prove(text: string): Promise<string>;               // a secret gist of mine holding text (proof.ts), its id
    unprove(id: string): Promise<string>;               // that gist, deleted
    proofOf(id: string): Promise<string>;               // a gist's owner and proof text, as JSON {owner, text} (the hub's read)
  };
  /** who is in */
  members: {
    ofOrg(org: string): Promise<string>;                // the org's members, one login a line
    inOrgAs(org: string, login: string, token: string): Promise<string>;   // throws when the login is not a member
    inOrg(org: string, login: string): Promise<string>;   // the same, asked by the hub's own sign-in (proof.ts)
    admin(repo: string): Promise<string>;               // "true" when I own the room
    people(repo: string): Promise<string>;              // who has access, people only, one login a line
    room(): Promise<string>;                            // the room of the folder this runs in, "owner/name"
    // let in (#162): a friend asks, the owner adds them, the friend accepts
    canWrite(repo: string): Promise<boolean>;           // may I push to it (a collaborator); false on any refusal (a 404 is one)
    invitations(): Promise<{ id: number; repo: string }[]>;   // the invitations waiting for me, repo as "owner/name"
    accept(id: number): Promise<string>;                // take one invitation; throws when it is not mine or gone
    invite(repo: string, login: string): Promise<"invited" | "already">;   // add a person, "already" when they were in
  };
  /** the things on the board */
  cards: {
    list(repo: string): Promise<any[]>;                 // the board's issues, open and recent
    prs(repo: string): Promise<any[]>;                  // the board's PRs, with their commits and files
    open(title: string, label: string, body: string, repo?: string): Promise<string>;   // a new card; its URL
    openIssues(): Promise<string>;                      // every open card here, with labels and assignees (JSON)
    held(): Promise<string>;                            // the open cards wearing `now` here (JSON)
    nowIn(repo: string): Promise<string>;               // the one open card wearing `now`, its number or ""
    find(title: string): Promise<string>;               // open cards here by title (JSON)
    pr(repo: string, n: number): Promise<string>;       // a PR's title, url and branch (JSON)
    assignees(issue: number): Promise<string>;          // who holds a card here, one login a line
    assign(repo: string, issue: number, who: string[]): Promise<string>;
    give(repo: string, n: number, to: string, pr: boolean): Promise<string>;
    passBack(repo: string, n: number, off: string, on: string): Promise<string>;
    addReviewer(repo: string, pr: number, to: string): Promise<string>;
    unlabel(issue: number, label: string): Promise<string>;
    letGo(repo: string, issue: number): Promise<string>;   // who was ever taken off a card, one login a line
    takenAt(issue: number): Promise<string>;            // when a card here was assigned or put on `now`, one time a line
  };
  /** the record on a card: hands, decisions, digests, "shown" */
  notes: {
    add(issue: number | string, body: string, repo?: string): Promise<string>;
    addOnPr(pr: number | string, body: string, repo?: string): Promise<string>;
    post(issue: number, body: string): Promise<string>;      // the same as add, on the room of the folder this runs in
    lines(issue: number): Promise<string>;              // a card's notes here, one JSON {body, at, login} a line
    of(repo: string, n: number): Promise<any[]>;        // a card's notes, oldest first
    recent(repo: string, sort: "created" | "updated"): Promise<any[]>;   // the room's last 100 notes, newest first
  };
  /** plans, shared cards, the room's things */
  files: {
    read(repo: string, path: string, ref?: string): Promise<string>;
    bytes(repo: string, path: string, ref?: string): Promise<Buffer>;
    readSha(repo: string, path: string, ref: string): Promise<string>;   // {sha, content (base64)} as JSON text
    put(repo: string, path: string, w: FileWrite, commit?: boolean): Promise<string>;   // commit: answers the commit's sha
    putBody(repo: string, path: string, body: { message: string; branch: string; content: string }): Promise<string>;
    tree(repo: string): Promise<string>;                // every file of the default branch (JSON)
    list(repo: string, dir: string, ref: string): Promise<string>;   // one folder on one branch (JSON)
    lastCommits(repo: string, items: { path: string; ref: string }[]): Promise<(LastCommit | undefined)[] | null>;   // null: refused
  };
  /** what moved */
  changes: {
    commitsBy(repo: string, login: string): Promise<any[]>;   // a person's last 30 commits
  };
  /** a new room's own record (#160): made from its name alone, under my account; answers it as "owner/name" */
  room: {
    make(name: string): Promise<string>;
  };
  /** only a code room */
  code: {
    branches(repo: string): Promise<any[]>;
    branch(repo: string, name: string): Promise<string>;     // its name when it is there
    mainSha(repo: string): Promise<string>;
    makeBranch(repo: string, name: string, sha: string): Promise<string>;
    heads(repo: string): Promise<string>;                     // every branch head (JSON)
    compare(repo: string, base: string, head: string): Promise<string>;   // ahead, behind, identical, diverged
    status(repo: string, sha: string, s: { state: string; context: string; description: string }): Promise<string>;
    prsOfBranch(branch: string): Promise<string>;             // the open PRs of a branch here, one number a line
    openPrs(): Promise<string>;                               // the open PRs here (JSON)
    prSearch(state: string, search: string, fields: string): Promise<string>;   // PRs here by a search (JSON)
    prHead(repo: string, n: number): Promise<string>;         // a PR's head, for a try (JSON)
    ready(repo: string, n: number): Promise<string>;
    prComment(repo: string, n: number, body: string): Promise<string>;   // its URL
    lineComment(repo: string, n: number, c: { body: string; commit: string; path: string; line: number }): Promise<string>;
  };
}

export { makeGithubRecord, runGh, runners, ghWithInput } from "./record/github.js";

let active: RoomRecord | null = null;
/** the room's record, the one place a provider is picked: for now always GitHub, through the real gh */
export function record(): RoomRecord {
  return (active ??= makeGithubRecord(runGh));
}
