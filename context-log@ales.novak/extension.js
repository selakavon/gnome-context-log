import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {CheckBox} from 'resource:///org/gnome/shell/ui/checkBox.js';

// One line per record: {"time":"2026-09-10T10:41:23+02:00","description":"Fix build"}
// A stop record {"time":"...","stop":true} ends the running task without
// starting another one (lunch, end of day).
const LOG_FILE = GLib.build_filenamev([GLib.get_user_data_dir(), 'context-log', 'entries.jsonl']);
const TODO_FILE = GLib.build_filenamev([GLib.get_user_data_dir(), 'context-log', 'todos.json']);
const TIMELINE_LIMIT = 50;
const DOUBLE_CLICK_MS = 400;

// To-do priority: High > Medium > Low. New to-dos start at Medium; clicking
// the chip cycles Medium -> High -> Low -> Medium.
const PRIORITIES = ['high', 'med', 'low'];
const PRIORITY_RANK = {high: 0, med: 1, low: 2};
const PRIORITY_NEXT = {med: 'high', high: 'low', low: 'med'};
const PRIORITY_LABEL = {high: 'H', med: 'M', low: 'L'};

function readEntries() {
    const file = Gio.File.new_for_path(LOG_FILE);
    if (!file.query_exists(null))
        return [];
    const [, bytes] = file.load_contents(null);
    const entries = [];
    for (const line of new TextDecoder().decode(bytes).split('\n')) {
        if (!line.trim())
            continue;
        try {
            const {time, description, stop} = JSON.parse(line);
            const dt = GLib.DateTime.new_from_iso8601(time, null);
            if (dt && stop === true)
                entries.push({unix: dt.to_unix(), stop: true});
            else if (dt && description)
                entries.push({unix: dt.to_unix(), description});
        } catch (e) {
            console.warn(`Context Log: skipping line: ${line}`);
        }
    }
    return entries;
}

// Append one record, e.g. {description: 'Fix build'} or {stop: true}.
function appendEntry(record) {
    const time = GLib.DateTime.new_now_local().format('%Y-%m-%dT%H:%M:%S%:z');
    GLib.mkdir_with_parents(GLib.path_get_dirname(LOG_FILE), 0o700);
    const stream = Gio.File.new_for_path(LOG_FILE).append_to(Gio.FileCreateFlags.NONE, null);
    stream.write_all(new TextEncoder().encode(`${JSON.stringify({time, ...record})}\n`), null);
    stream.close(null);
}

// Run `callback` when `actor` is pressed twice within DOUBLE_CLICK_MS.
// A single press propagates so a button still shows its pressed state.
function onDoubleClick(actor, callback) {
    let lastPressMs = 0;
    actor.connect('button-press-event', () => {
        const nowMs = GLib.get_monotonic_time() / 1000;
        if (nowMs - lastPressMs < DOUBLE_CLICK_MS) {
            lastPressMs = 0;
            callback();
            return Clutter.EVENT_STOP;
        }
        lastPressMs = nowMs;
        return Clutter.EVENT_PROPAGATE;
    });
}

function formatDuration(seconds) {
    const minutes = Math.round(seconds / 60);
    if (minutes < 60)
        return `${minutes}m`;
    return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

// To-dos: a JSON array of {text, done, priority, added, doneAt?}.
// Older files (without priority/added) are migrated in place on read; no data
// is dropped. `added` is a monotonic key used only to order equal priorities.
// `doneAt` (ms since the epoch) is set when a to-do is checked off and removed
// when it is reopened; to-dos finished before it existed simply have none.
function readTodos() {
    const file = Gio.File.new_for_path(TODO_FILE);
    if (!file.query_exists(null))
        return [];
    let data;
    try {
        const [, bytes] = file.load_contents(null);
        data = JSON.parse(new TextDecoder().decode(bytes));
    } catch (e) {
        console.warn(`Context Log: cannot read todos: ${e.message}`);
        return [];
    }
    if (!Array.isArray(data))
        return [];
    let changed = false;
    const todos = [];
    data.forEach((t, i) => {
        if (!t || typeof t.text !== 'string') {
            changed = true;
            return;
        }
        const priority = PRIORITIES.includes(t.priority) ? t.priority : 'med';
        const added = typeof t.added === 'number' ? t.added : i;
        if (t.priority !== priority || typeof t.added !== 'number')
            changed = true;
        const todo = {text: t.text, done: !!t.done, priority, added};
        if (todo.done && typeof t.doneAt === 'number')
            todo.doneAt = t.doneAt;
        else if (t.doneAt !== undefined)
            changed = true;
        todos.push(todo);
    });
    if (changed)
        writeTodos(todos);
    return todos;
}

function writeTodos(todos) {
    GLib.mkdir_with_parents(GLib.path_get_dirname(TODO_FILE), 0o700);
    Gio.File.new_for_path(TODO_FILE).replace_contents(
        new TextEncoder().encode(JSON.stringify(todos, null, 2)),
        null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
}

const Indicator = GObject.registerClass(
class ContextLogIndicator extends PanelMenu.Button {
    _init() {
        super._init(0.5, 'Context Log');
        this._entries = [];
        this._focusId = 0;
        this._closeOnRelease = false;

        const box = new St.BoxLayout({style_class: 'panel-status-menu-box'});
        box.add_child(new St.Icon({icon_name: 'document-edit-symbolic', style_class: 'system-status-icon'}));
        this._label = new St.Label({y_align: Clutter.ActorAlign.CENTER, style_class: 'context-log-panel-label'});
        this._label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        box.add_child(this._label);
        this.add_child(box);

        // Entry: type a description, Enter records it with the current time.
        // With "Add as todo" checked (the default) it also goes on the to-do list.
        const entryItem = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        this._entry = new St.Entry({hint_text: 'What are you working on?', x_expand: true, style_class: 'context-log-entry'});
        this._entry.clutter_text.connect('activate', () => {
            this._record(this._entry.get_text(), {addTodo: this._addTodoCheck.checked});
            this._closeOnRelease = true;
        });
        // Close on the Return *release*: closing on the press would let the
        // release reach the Activities button, which toggles the overview.
        this._entry.clutter_text.connect('key-release-event', () => {
            if (!this._closeOnRelease)
                return Clutter.EVENT_PROPAGATE;
            this._closeOnRelease = false;
            this.menu.close();
            return Clutter.EVENT_STOP;
        });
        entryItem.add_child(this._entry);
        this._addTodoCheck = new CheckBox('Add as todo');
        this._addTodoCheck.checked = true;
        this._addTodoCheck.y_align = Clutter.ActorAlign.CENTER;
        this._addTodoCheck.getLabelActor().clutter_text.set_line_wrap(false);
        entryItem.add_child(this._addTodoCheck);
        this.menu.addMenuItem(entryItem);

        // To-do: a simple checklist. Add on Enter, click to toggle, X to remove.
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem('To-do'));
        const todoEntryItem = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        this._todoEntry = new St.Entry({hint_text: 'Add a to-do', x_expand: true, style_class: 'context-log-entry'});
        this._todoEntry.clutter_text.connect('activate', () => {
            const text = this._todoEntry.get_text().trim();
            if (text) {
                const todos = readTodos();
                todos.push({text, done: false, priority: 'med', added: Date.now()});
                writeTodos(todos);
                this._todoTab = 'open';
            }
            this._todoEntry.set_text('');
            this._refreshTodos();
            this._todoEntry.grab_key_focus();
        });
        todoEntryItem.add_child(this._todoEntry);
        this.menu.addMenuItem(todoEntryItem);
        // Tabs: "Open" lists what is still to do (by priority, then time
        // added); "Done" lists finished to-dos, most recently finished first.
        this._todoTab = 'open';
        this._todoTabs = {};
        const tabsItem = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        for (const tab of ['open', 'done']) {
            const btn = new St.Button({style_class: 'context-log-tab'});
            btn.connect('clicked', () => {
                this._todoTab = tab;
                this._refreshTodos();
            });
            this._todoTabs[tab] = btn;
            tabsItem.add_child(btn);
        }
        this.menu.addMenuItem(tabsItem);
        this._todoList = new St.BoxLayout({vertical: true, style_class: 'context-log-todo-list'});
        const todoSection = new PopupMenu.PopupMenuSection();
        todoSection.actor.add_child(this._todoList);
        this.menu.addMenuItem(todoSection);

        // Timeline: date-time, description, time spent. Double-click a row to
        // work on that task again; the newest row has a stop button.
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem('Timeline'));
        this._timeline = new St.BoxLayout({vertical: true});
        const scroll = new St.ScrollView({
            style_class: 'context-log-timeline',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            child: this._timeline,
        });
        const timelineSection = new PopupMenu.PopupMenuSection();
        timelineSection.actor.add_child(scroll);
        this.menu.addMenuItem(timelineSection);

        this.menu.connect('open-state-changed', (_menu, open) => {
            if (!open)
                return;
            this._closeOnRelease = false;
            this._entry.set_text('');
            this._addTodoCheck.checked = true;
            this._todoTab = 'open';
            this._refresh();
            this._focusId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this._focusId = 0;
                this._entry.grab_key_focus();
                return GLib.SOURCE_REMOVE;
            });
        });
        this._refresh();
    }

    _record(description, {addTodo = false} = {}) {
        description = description.trim();
        if (!description)
            return;
        const last = this._entries[this._entries.length - 1];
        if (!last || last.description !== description)
            appendEntry({description});
        if (addTodo)
            this._addTodo(description);
        this._refresh();
    }

    _stop() {
        const last = this._entries[this._entries.length - 1];
        if (last && !last.stop)
            appendEntry({stop: true});
        this._refresh();
    }

    // Add a to-do with this text unless one already exists (done or not).
    _addTodo(text) {
        const todos = readTodos();
        if (todos.some(t => t.text === text))
            return;
        todos.push({text, done: false, priority: 'med', added: Date.now()});
        writeTodos(todos);
    }

    _refresh() {
        this._entries = readEntries();
        const now = Math.floor(Date.now() / 1000);
        const last = this._entries[this._entries.length - 1];
        const running = !!last && !last.stop;
        this._label.text = running ? last.description : '';

        this._timeline.destroy_all_children();
        const first = Math.max(0, this._entries.length - TIMELINE_LIMIT);
        for (let i = this._entries.length - 1; i >= first; i--) {
            const entry = this._entries[i];
            const end = this._entries[i + 1]?.unix ?? now;
            // The row itself is reactive (hover highlight, double-click) rather
            // than wrapped in a button, so it is laid out like a plain list row.
            const row = new St.BoxLayout({
                style_class: 'context-log-row',
                reactive: !entry.stop,
                track_hover: !entry.stop,
            });
            row.add_child(new St.Label({
                text: GLib.DateTime.new_from_unix_local(entry.unix).format('%Y-%m-%d %H:%M'),
                style_class: 'context-log-time',
            }));
            const desc = new St.Label({
                text: entry.stop ? 'Stopped' : entry.description,
                x_expand: true,
                style_class: entry.stop ? 'context-log-desc context-log-stop' : 'context-log-desc',
            });
            desc.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            if (entry.stop)
                desc.opacity = 140;
            row.add_child(desc);
            // A stop row has no "time spent": it only ends the task above it.
            row.add_child(new St.Label({
                text: entry.stop ? '' : formatDuration(end - entry.unix),
                style_class: 'context-log-duration',
            }));
            // Stop button on the running task (the newest row); the other rows
            // get a same-width spacer so the columns stay aligned.
            if (i === this._entries.length - 1 && !entry.stop) {
                const stopBtn = new St.Button({
                    style_class: 'context-log-stop-btn',
                    child: new St.Icon({icon_name: 'media-playback-stop-symbolic', icon_size: 16}),
                });
                stopBtn.connect('clicked', () => this._stop());
                row.add_child(stopBtn);
            } else {
                row.add_child(new St.Widget({style_class: 'context-log-stop-spacer'}));
            }
            if (!entry.stop)
                onDoubleClick(row, () => this._record(entry.description));
            this._timeline.add_child(row);
        }

        this._refreshTodos();
    }

    _refreshTodos() {
        // `todos` is the full list and is what gets written back; the tabs
        // only show a filtered, sorted view of it.
        const todos = readTodos();
        const open = todos.filter(t => !t.done);
        const done = todos.filter(t => t.done);
        // Open: by priority first, then by time added (oldest first).
        open.sort((a, b) =>
            (PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]) || (a.added - b.added));
        // Done: most recently finished first. To-dos finished before the done
        // time was recorded have no `doneAt` and fall back to their added time.
        done.sort((a, b) => (b.doneAt ?? b.added) - (a.doneAt ?? a.added));
        this._todoTabs.open.label = `Open (${open.length})`;
        this._todoTabs.done.label = `Done (${done.length})`;
        for (const [tab, btn] of Object.entries(this._todoTabs))
            btn.checked = tab === this._todoTab;
        const shown = this._todoTab === 'done' ? done : open;

        this._todoList.destroy_all_children();
        if (shown.length === 0) {
            const empty = new St.Label({
                text: this._todoTab === 'done' ? 'No done to-dos' : 'No open to-dos',
                style_class: 'context-log-todo-empty',
            });
            empty.opacity = 140;
            this._todoList.add_child(empty);
            return;
        }
        const current = this._label.text;
        shown.forEach(todo => {
            const isCurrent = current !== '' && todo.text === current;
            const toggle = () => {
                todo.done = !todo.done;
                if (todo.done)
                    todo.doneAt = Date.now();
                else
                    delete todo.doneAt;
                writeTodos(todos);
                this._refreshTodos();
            };
            const row = new St.BoxLayout({
                style_class: isCurrent ? 'context-log-todo-row context-log-todo-current' : 'context-log-todo-row',
            });
            const check = new St.Button({
                style_class: 'context-log-todo-check',
                child: new St.Icon({
                    icon_name: todo.done ? 'checkbox-checked-symbolic' : 'checkbox-symbolic',
                    icon_size: 16,
                }),
            });
            check.connect('clicked', toggle);
            // Priority chip: click to cycle Medium -> High -> Low.
            const prio = new St.Button({style_class: 'context-log-prio'});
            prio.set_child(new St.Label({
                text: PRIORITY_LABEL[todo.priority],
                y_align: Clutter.ActorAlign.CENTER,
                style_class: `context-log-prio-letter context-log-prio-${todo.priority}`,
            }));
            prio.connect('clicked', () => {
                todo.priority = PRIORITY_NEXT[todo.priority];
                writeTodos(todos);
                this._refreshTodos();
            });
            const label = new St.Label({
                x_expand: true,
                x_align: Clutter.ActorAlign.START,
                y_align: Clutter.ActorAlign.CENTER,
            });
            label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            let markup = GLib.markup_escape_text(todo.text, -1);
            if (todo.done)
                markup = `<s>${markup}</s>`;
            if (isCurrent)
                markup = `<b>${markup}</b>`;
            label.clutter_text.set_markup(markup);
            // Double-clicking the text sets this to-do as the task you're working on now.
            const labelBtn = new St.Button({
                x_expand: true,
                x_align: Clutter.ActorAlign.FILL,
                child: label,
                style_class: 'context-log-todo-labelbtn',
            });
            onDoubleClick(labelBtn, () => this._record(todo.text));
            if (todo.done)
                labelBtn.opacity = 140;
            const remove = new St.Button({
                style_class: 'context-log-todo-remove',
                child: new St.Icon({icon_name: 'window-close-symbolic', icon_size: 16}),
            });
            remove.connect('clicked', () => {
                const idx = todos.indexOf(todo);
                if (idx >= 0)
                    todos.splice(idx, 1);
                writeTodos(todos);
                this._refreshTodos();
            });
            row.add_child(check);
            row.add_child(prio);
            row.add_child(labelBtn);
            if (todo.done) {
                // When it was finished; blank for to-dos done before this was recorded.
                row.add_child(new St.Label({
                    text: todo.doneAt === undefined ? ''
                        : GLib.DateTime.new_from_unix_local(Math.floor(todo.doneAt / 1000)).format('%Y-%m-%d %H:%M'),
                    y_align: Clutter.ActorAlign.CENTER,
                    style_class: 'context-log-time context-log-todo-done-at',
                }));
            }
            row.add_child(remove);
            this._todoList.add_child(row);
        });
    }

    destroy() {
        if (this._focusId)
            GLib.source_remove(this._focusId);
        super.destroy();
    }
});

export default class ContextLogExtension extends Extension {
    enable() {
        this._indicator = new Indicator();
        Main.panel.addToStatusArea(this.uuid, this._indicator, 1, 'left');
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
