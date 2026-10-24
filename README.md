# Sol

One window for all your AI. Sol is a face on your own machine that talks to a local engine: your chats, your
work with coding agents, your browser, a desk for notes and cards, voice, and the tools you make, in one place
that is yours. The engine runs on your computer, your data stays in your folder, and Sol changes itself from the
inside when you ask it to.

The idea: today each AI lives in its own tab and knows nothing of the others. Sol is the one surface you sit
at, and the AIs are its hands. Over time it becomes the system you need, built by being talked to.

This is the version beta testers run: stable-20261023-2237. It is made from the development repository by the stamp that
moves stable, and holds only what runs. Nothing here is edited by hand; the next version replaces it.

## Install

Your kit's START-HERE.md walks your agent through the setup. Without it:

- **Mac**: in Terminal.
- **Linux**: in a terminal; the engine runs as a user service.
- **Windows**: inside Ubuntu under WSL (`wsl --install` once in PowerShell); the face opens in Edge or Chrome.

```
gh repo clone marcocyl04-ux/sol-beta ~/computer/personal/projects/ecosystem
cd ~/computer/personal/projects/ecosystem && bash sol/setup
```

Setup asks a few questions. Skip the Tailscale and team-key ones: there are no team features in a beta Sol (no
relay, no shared view, no Hand).

## Make it yours

Sol changes itself when you ask it to. To keep those changes yours across new versions, give them a branch once:

```
git switch -c <you>/mine && bash sol/mine/setup
```

Every commit there gets `mine: ` in front. The harness comes along (`sol/harness/guard`, wired by
`.claude/settings.json`): it refuses, before it runs, what a session in your Sol should never do.

## Keep it current

A new version: `git pull` in that folder; Sol rebuilds itself. On your own branch, `bash sol/mine/rebase` instead:
it puts your changes on top of the new version, and if one does not fit it names the place and changes nothing. When something breaks, `sol/HELP.md`.
Something wrong, or a thought: open an issue on this repository.
