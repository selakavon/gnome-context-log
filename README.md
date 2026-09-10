# Context Log (GNOME Shell extension)

Top-panel widget recording what you are working on.

- Click it, type a one-line description, press Enter: recorded with the current time.
- Click a description under **Previous** to switch back to it.
- **Timeline** lists each record: date-time, description, time spent (until the next record).
- **To-do** is a simple checklist: type and press Enter to add. Click a to-do's text to set it as the task you're working on now (it gets recorded in the log and highlighted). Click its checkbox to toggle done, the X to remove. Stored in `~/.local/share/context-log/todos.json`.

Log: `~/.local/share/context-log/entries.jsonl`, one JSON object per line.
Install / update: `./install.sh` (copies into `~/.local/share/gnome-shell/extensions/` and restarts the shell on X11).
