# When Sol breaks

The same steps are in Sol itself: Settings (the gear, bottom right) → engine. They work with the engine down.
No Claude Code needed, nothing to understand first.
Setup broken? Run `bash sol/setup --check`: it says what is missing and how to get it.

1. **Wait a minute.** The engine restarts itself under its keeper. After three bad starts in a row the keeper
   puts the last good build back on its own, and Sol says "engine went back to its last good build".

2. **Pick the other engine.** Settings → engine → which: live, the NucBox. Keep working there.

3. **Still down after two minutes: one line in Terminal.** Press Cmd-Space, type Terminal, press return, paste
   this and press return:

   ```
   bash ~/computer/personal/projects/ecosystem/sol/back
   ```

   It puts the last good engine build back, takes back the last change Sol made to its own face (an unsaved edit
   is set aside, nothing is lost), and starts the engine and its build watcher again. It says what it did, line
   by line, and ends with "the engine answers; open Sol". On the NucBox the same line works, with `~/sol-live` in
   place of `~/computer/personal/projects/ecosystem`.

4. **Sol.app will not open.** The same line from Terminal, then open Sol again (Cmd-Space, Sol).

5. **Sol is up but wrong.** Settings → engine → go back. The row says what the click does before you click: the
   engine to its good build of such a time, the face's last change. Once more goes one further back.

6. **None of it helps.** Open Claude Code in `~/computer/personal/projects/ecosystem` and say "Sol is down, read
   sol/HELP.md and the engine log" (`~/Library/Logs/sol-engine.log`). That is the last door, not the first.
