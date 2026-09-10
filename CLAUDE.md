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

### Rules

1. **Reinstall keeps data.** `install.sh` may `rm -rf` and re-copy only the
   extension code directory (`.../gnome-shell/extensions/context-log@ales.novak`).
   It must never touch `~/.local/share/context-log/`. Verify this before
   changing the installer.
2. **No destructive test steps in the real data dir.** When testing, back up
   `~/.local/share/context-log/` first, or point the extension at a throwaway
   path. Do not `rm` the user's real `entries.jsonl` / `todos.json`.
3. **Format changes migrate in place.** If a new version changes the on-disk
   schema, it must read the old data and convert it, keeping every existing
   record. Never start from an empty file when old data is present. Prefer
   backward-compatible additions (new optional fields) over breaking changes.
4. **Fail safe on read errors.** A corrupt or unreadable line must be skipped
   with a warning, never cause the file to be truncated or rewritten empty.

Before shipping any change or running any reinstall, confirm the two data files
above are intact and unchanged (unless the change is a deliberate, tested
migration).
