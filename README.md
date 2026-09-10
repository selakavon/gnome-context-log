# Context Log (GNOME Shell extension)

Top-panel widget recording what you are working on.

- Click it, type a one-line description, press Enter: recorded with the current time. The **Add as todo** checkbox next to the field (on by default) also puts the task on the to-do list, unless a to-do with the same text already exists.
- The newest timeline row has a **stop** button that ends the running task without starting a new one (lunch, end of day). The panel label clears, the task's time spent ends there, and the timeline shows a *Stopped* row.
- **Timeline** lists each record: date-time, description, time spent (until the next record). Double-click a row to work on that task again.
- **To-do** is a simple checklist: type and press Enter to add. Double-click a to-do's text to set it as the task you're working on now (it gets recorded in the log and highlighted). Click its checkbox to toggle done, the X to remove. Each item has a priority chip (H/M/L); new to-dos start at Medium, and clicking the chip cycles Medium -> High -> Low. The list is sorted by priority first, then by time added. Stored in `~/.local/share/context-log/todos.json`.

Log: `~/.local/share/context-log/entries.jsonl`, one JSON object per line: `{"time":…,"description":…}`, or `{"time":…,"stop":true}` for a stop.
Install / update: `./install.sh` (copies into `~/.local/share/gnome-shell/extensions/` and restarts the shell on X11).
