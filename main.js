'use strict';

var obsidian = require('obsidian');

/******************************************************************************
Copyright (c) Microsoft Corporation.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
***************************************************************************** */
/* global Reflect, Promise */


function __awaiter(thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, [])).next());
    });
}

// --- Support alternative checkbox syntaxes ---
const UNCHECKED_REGEX = /-\s*\[(?: |☐|❍|■|–|>|•|\*)?\]/gi;
const CHECKED_REGEX = /-\s*\[(?:x|X|✔|✓|🗹|☑|⊠|✅)?\]/gi;
const DEFAULT_SETTINGS = {
    notePath: "",
    noteType: "daily",
    trackMode: "latest",
    colorMode: "theme",
};
// --- Main Plugin Class ---
class ProgressivePlugin extends obsidian.Plugin {
    constructor() {
        super(...arguments);
        this.progressBarContainer = null;
        this.progressBarFill = null;
        this.progressPercentLabel = null;
        this.updateTimer = null;
        this.styleEl = null;
    }
    onload() {
        return __awaiter(this, void 0, void 0, function* () {
            // --- Load plugin styles ---
            this.styleEl = document.createElement("link");
            this.styleEl.rel = "stylesheet";
            this.styleEl.type = "text/css";
            this.styleEl.href = this.app.vault.adapter.getResourcePath(this.manifest.dir + "/styles.css");
            document.head.appendChild(this.styleEl);
            // --- Load settings and add settings tab ---
            yield this.loadSettings();
            this.addSettingTab(new ProgressiveSettingTab(this.app, this));
            this.app.workspace.onLayoutReady(() => __awaiter(this, void 0, void 0, function* () {
                const fileExplorerLeaves = this.app.workspace.getLeavesOfType("file-explorer");
                if (!fileExplorerLeaves.length)
                    return;
                const leaf = fileExplorerLeaves[0];
                const container = leaf.view.containerEl;
                // --- Create progress bar container ---
                this.progressBarContainer = document.createElement("div");
                this.progressBarContainer.className = "progressive-container";
                // --- Label ---
                this.progressPercentLabel = document.createElement("span");
                this.progressPercentLabel.className = "progressive-percent";
                this.progressPercentLabel.textContent = "0%";
                // --- Wrapper ---
                const wrapper = document.createElement("div");
                wrapper.className = "progressive-wrapper";
                // --- Fill ---
                this.progressBarFill = document.createElement("div");
                this.progressBarFill.className = "progressive-bar";
                this.progressBarFill.style.width = "0%";
                wrapper.appendChild(this.progressBarFill);
                this.progressBarContainer.appendChild(this.progressPercentLabel);
                this.progressBarContainer.appendChild(wrapper);
                container.appendChild(this.progressBarContainer);
                // --- Initial Update ---
                yield this.updateProgressBar();
                // --- File system event listeners ---
                this.registerEvent(this.app.vault.on("modify", () => this.debouncedUpdate()));
                this.registerEvent(this.app.vault.on("create", () => this.debouncedUpdate()));
                this.registerEvent(this.app.vault.on("delete", () => this.debouncedUpdate()));
                this.registerEvent(this.app.vault.on("rename", () => this.debouncedUpdate()));
                // --- Periodic update for folders ---
                this.registerInterval(window.setInterval(() => this.updateProgressBar(), 10000));
            }));
        });
    }
    onunload() {
        if (this.progressBarContainer)
            this.progressBarContainer.remove();
        if (this.updateTimer)
            window.clearTimeout(this.updateTimer);
        // Clean up stylesheet
        if (this.styleEl && this.styleEl.parentNode) {
            this.styleEl.parentNode.removeChild(this.styleEl);
            this.styleEl = null;
        }
    }
    debouncedUpdate() {
        if (this.updateTimer)
            window.clearTimeout(this.updateTimer);
        this.updateTimer = window.setTimeout(() => this.updateProgressBar(), 1000);
    }
    updateProgressBar() {
        var _a, _b;
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.settings.notePath)
                return;
            let filesToCheck = [];
            const target = this.app.vault.getAbstractFileByPath(this.settings.notePath);
            if (target instanceof obsidian.TFile) {
                filesToCheck = [target];
            }
            else if (target instanceof obsidian.TFolder) {
                filesToCheck = this.app.vault
                    .getMarkdownFiles()
                    .filter((f) => f.path.startsWith(this.settings.notePath + "/"));
            }
            else {
                filesToCheck = this.app.vault
                    .getMarkdownFiles()
                    .filter((f) => f.path.startsWith(this.settings.notePath));
            }
            if (!filesToCheck.length)
                return;
            const now = new Date();
            // --- Filter based on tracking mode ---
            if (this.settings.trackMode === "latest") {
                filesToCheck.sort((a, b) => b.stat.mtime - a.stat.mtime);
                filesToCheck = [filesToCheck[0]];
            }
            else if (this.settings.trackMode === "today" && !(target instanceof obsidian.TFile)) {
                if (this.settings.noteType === "daily") {
                    const todayStr = `${String(now.getDate()).padStart(2, "0")}-${String(now.getMonth() + 1).padStart(2, "0")}-${now.getFullYear()}`;
                    filesToCheck = filesToCheck.filter((f) => f.basename.includes(todayStr));
                }
                else if (this.settings.noteType === "weekly") {
                    const getISOWeek = (date) => {
                        const temp = new Date(date.getTime());
                        temp.setHours(0, 0, 0, 0);
                        temp.setDate(temp.getDate() + 4 - (temp.getDay() || 7));
                        const yearStart = new Date(temp.getFullYear(), 0, 1);
                        return Math.ceil(((temp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
                    };
                    const weekStr = `W${getISOWeek(now)}-${now.getFullYear()}`;
                    filesToCheck = filesToCheck.filter((f) => f.basename.includes(weekStr));
                }
                else if (this.settings.noteType === "monthly") {
                    const monthStr = `${String(now.getMonth() + 1).padStart(2, "0")}-${now.getFullYear()}`;
                    filesToCheck = filesToCheck.filter((f) => f.basename.includes(monthStr));
                }
            }
            // --- Compute progress ---
            let totalTasks = 0;
            let doneTasks = 0;
            for (const f of filesToCheck) {
                const content = yield this.app.vault.cachedRead(f);
                const uncheckedMatches = ((_a = content.match(UNCHECKED_REGEX)) === null || _a === void 0 ? void 0 : _a.length) || 0;
                const checkedMatches = ((_b = content.match(CHECKED_REGEX)) === null || _b === void 0 ? void 0 : _b.length) || 0;
                totalTasks += uncheckedMatches;
                doneTasks += checkedMatches;
            }
            const percent = totalTasks + doneTasks > 0
                ? Math.round((doneTasks / (totalTasks + doneTasks)) * 100)
                : 0;
            this.updateBarUI(percent);
        });
    }
    updateBarUI(percent) {
        if (!this.progressBarFill || !this.progressPercentLabel)
            return;
        this.progressBarFill.style.width = `${percent}%`;
        this.progressPercentLabel.textContent = `${percent}%`;
        if (this.settings.colorMode === "multicolor") {
            const colors = [
                "#ff0000", "#ff3300", "#ff6600", "#ff9900",
                "#ffcc00", "#ffff00", "#c1e703", "#a7e400",
                "#84e103", "#57cd02", "#00be09", "#01a80c",
            ];
            const index = Math.min(colors.length - 1, Math.floor((percent / 100) * colors.length));
            this.progressBarFill.style.backgroundColor = colors[index];
        }
        else if (this.settings.colorMode === "bw") {
            const isDark = document.body.classList.contains("theme-dark");
            this.progressBarFill.style.backgroundColor = isDark ? "white" : "black";
        }
        else {
            this.progressBarFill.style.backgroundColor = "var(--interactive-accent)";
        }
    }
    loadSettings() {
        return __awaiter(this, void 0, void 0, function* () {
            this.settings = Object.assign({}, DEFAULT_SETTINGS, yield this.loadData());
        });
    }
    saveSettings() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.saveData(this.settings);
            yield this.updateProgressBar();
        });
    }
}
// --- Settings Tab ---
class ProgressiveSettingTab extends obsidian.PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }
    display() {
        const { containerEl } = this;
        containerEl.empty();
        new obsidian.Setting(containerEl)
            .setName("Track Note / Folder")
            .setDesc("Choose the note or folder to track")
            .addText((text) => text
            .setPlaceholder("path/to/note/or/folder")
            .setValue(this.plugin.settings.notePath)
            .onChange((value) => __awaiter(this, void 0, void 0, function* () {
            this.plugin.settings.notePath = value;
            yield this.plugin.saveSettings();
        })));
        new obsidian.Setting(containerEl)
            .setName("Note Type")
            .setDesc("Choose the note type to track")
            .addDropdown((dropdown) => dropdown
            .addOption("daily", "Daily")
            .addOption("weekly", "Weekly")
            .addOption("monthly", "Monthly")
            .addOption("custom", "Custom")
            .setValue(this.plugin.settings.noteType)
            .onChange((value) => __awaiter(this, void 0, void 0, function* () {
            this.plugin.settings.noteType = value;
            yield this.plugin.saveSettings();
        })));
        new obsidian.Setting(containerEl)
            .setName("Tracking Mode")
            .setDesc("Which notes to include in progress")
            .addDropdown((dropdown) => dropdown
            .addOption("latest", "Latest note only")
            .addOption("today", "Today’s note only")
            .addOption("all", "All notes in folder")
            .setValue(this.plugin.settings.trackMode)
            .onChange((value) => __awaiter(this, void 0, void 0, function* () {
            this.plugin.settings.trackMode = value;
            yield this.plugin.saveSettings();
        })));
        new obsidian.Setting(containerEl)
            .setName("Progress Bar Color Mode")
            .setDesc("Choose the color behavior of the progress bar")
            .addDropdown((dropdown) => dropdown
            .addOption("theme", "Theme accent color")
            .addOption("multicolor", "Multicolor scale")
            .addOption("bw", "Black/White (theme-based)")
            .setValue(this.plugin.settings.colorMode)
            .onChange((value) => __awaiter(this, void 0, void 0, function* () {
            this.plugin.settings.colorMode = value;
            yield this.plugin.saveSettings();
        })));
    }
}

module.exports = ProgressivePlugin;
//# sourceMappingURL=main.js.map
