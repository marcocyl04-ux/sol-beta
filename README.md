# Sol

One window for all your AI. Sol is a face on your own machine that talks to a local engine: your chats, your
work with coding agents, your browser, a desk for notes and cards, voice, and the tools you make, in one place
that is yours. The engine runs on your computer, your data stays in your folder, and Sol changes itself from the
inside when you ask it to.

The idea: today each AI lives in its own tab and knows nothing of the others. Sol is the one surface you sit
at, and the AIs are its hands. Over time it becomes the system you need, built by being talked to.

This is the version beta testers run: stable-20261029-2019. It is made from the development repository by the stamp that
moves stable, and holds only what runs. Nothing here is edited by hand; the next version replaces it.

## Install

**Mac**, one line in Terminal. It asks what to call you, puts Sol in `~/Sol`, and opens Sol.app:

```
curl -fsSL https://sol.matterfold.tech/install | sh
```

Or download `Sol-mac.zip` from the [latest release](https://github.com/marcocyl04-ux/sol-beta/releases/latest),
unzip it and open Sol. It is not signed with Apple yet: the first time, macOS says it cannot check it, and
System Settings → Privacy & Security has an **Open Anyway** button; click it once. Sol then asks the same
question and sets itself up.

**Linux**, and **Windows** inside Ubuntu under WSL (`wsl --install` once in PowerShell): the same line; there is
no app, the face opens in your browser at http://localhost:1420.

Both ask you to sign in to Claude (a Claude Pro or Max plan). ChatGPT (Plus or Pro, through Codex) works too: a
chat starts on Codex, which signs you in the first time you talk to it, and a coding session in Work runs on
Claude unless you pick GPT. Rooms you share with others (Cowork) meet on Sol's cloud, signed in with your Google
account; the team's own machinery (the Hand, the stamp) is not in a beta Sol.

## Make it yours

Sol changes itself when you ask it to. To keep those changes yours across new versions, give them a branch once:

```
git switch -c <you>/mine && bash sol/mine/setup
```

Every commit there gets `mine: ` in front. The harness comes along (`sol/harness/guard`, wired by
`.claude/settings.json`): it refuses, before it runs, what a session in your Sol should never do.

## Keep it current

A new version: Sol says so in its own window within the hour, with an **Update** button; press it and Sol
fetches the new version and rebuilds its engine and face from it. The Mac app's own shell comes from the
[latest release](https://github.com/marcocyl04-ux/sol-beta/releases/latest) when it changed; the release notes say so. On your own branch, `bash sol/mine/rebase` instead:
it puts your changes on top of the new version, and if one does not fit it names the place and changes nothing. When something breaks, `sol/HELP.md`.
Something wrong, or a thought: open an issue on this repository.
