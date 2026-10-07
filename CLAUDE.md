# Context Log — project guidance

## Hard prerequisite: never lose the user's stored data

The user's recorded data is the whole point of this tool. It **must survive**
every reinstall, upgrade, and future code change. Treat this as a blocking
requirement for any further work, not a nice-to-have.

The data lives **outside** the extension, in its own directory:

- `~/.local/share/context-log/entries.jsonl` — the context-switch log
- `~/.local/share/context-log/todos.json` — the to-do list

The extension **code** lives separately in
`~/.local/share/gnome-shell/extensions/context-log@ales.novak/`. Reinstalling
replaces only that code directory; it must never delete, move, or overwrite the
data directory.

## Mandatory testing procedure: back up → test → restore

Whenever a new version is developed and **any** testing is done in the widget,
you MUST follow this exact order. This is not optional. Real user records have
already been destroyed once by test steps that deleted the data files; that must
never happen again.

1. **Back up first.** Before installing a test build or interacting with the
   widget for testing, copy the real data directory to a timestamped backup
   OUTSIDE the data directory. Do this even for "quick" tests.

   ```sh
   BK="$HOME/.local/share/context-log-backups/$(date +%Y%m%d-%H%M%S)"
   mkdir -p "$BK"
   cp -a "$HOME/.local/share/context-log/." "$BK/" 2>/dev/null || true
   echo "backed up real data to $BK"
   ```

2. **Test.** Only now install the new version and exercise it. Any seeding,
   clearing, or `rm` of `entries.jsonl` / `todos.json` during testing acts on
   throwaway test data, never on records you have not first backed up.

3. **Restore last.** When testing is finished, restore the real data from the
   backup you made in step 1, discarding whatever the test left behind:

   ```sh
   rm -f "$HOME/.local/share/context-log/entries.jsonl" \
         "$HOME/.local/share/context-log/todos.json"
   cp -a "$BK/." "$HOME/.local/share/context-log/" 2>/dev/null || true
   echo "restored real data from $BK"
   ```

   Then reopen the widget and confirm the real records are all present before
   considering the work done.

Never delete or overwrite the real data files without a verified backup made in
step 1 first. If in doubt, keep the backup — backups are cheap, the records are
irreplaceable. Keep the timestamped backups under
`~/.local/share/context-log-backups/`; they are never committed to git.

### Rules

1. **Reinstall keeps data.** `install.sh` may `rm -rf` and re-copy only the
   extension code directory (`.../gnome-shell/extensions/context-log@ales.novak`).
   It must never touch `~/.local/share/context-log/`. Verify this before
   changing the installer.
2. **No destructive test steps in the real data dir.** Always follow the
   back up → test → restore procedure above. Never `rm` or overwrite the user's
   real `entries.jsonl` / `todos.json` without a verified backup made first.
3. **Format changes migrate in place.** If a new version changes the on-disk
   schema, it must read the old data and convert it, keeping every existing
   record. Never start from an empty file when old data is present. Prefer
   backward-compatible additions (new optional fields) over breaking changes.
4. **Fail safe on read errors.** A corrupt or unreadable line must be skipped
   with a warning, never cause the file to be truncated or rewritten empty.

Before shipping any change or running any reinstall, confirm the two data files
above are intact and unchanged (unless the change is a deliberate, tested
migration).

## Always commit and push

Once a change is implemented, tested and installed, commit it and push to
`origin/main` in the same session, without waiting to be asked. Never leave
finished work uncommitted in the working tree or commits unpushed. Keep each
commit to one change, as in the existing history.
