import {
	App,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
	TFolder,
} from "obsidian";

// --- Support alternative checkbox syntaxes ---
const UNCHECKED_REGEX = /-\s*\[(?: |☐|❍|■|–|>|•|\*)?\]/gi;
const CHECKED_REGEX   = /-\s*\[(?:x|X|✔|✓|🗹|☑|⊠|✅)?\]/gi;

// --- Settings interface ---
interface ProgressiveSettings {
	notePath: string;
	noteType: "daily" | "weekly" | "monthly" | "custom";
	trackMode: "latest" | "today" | "all";
	colorMode: "multicolor" | "bw" | "theme";
}

const DEFAULT_SETTINGS: ProgressiveSettings = {
	notePath: "",
	noteType: "daily",
	trackMode: "latest",
	colorMode: "theme",
};

// --- Main Plugin Class ---
export default class ProgressivePlugin extends Plugin {
	settings: ProgressiveSettings;
	private progressBarContainer: HTMLElement | null = null;
	private progressBarFill: HTMLDivElement | null = null;
	private progressPercentLabel: HTMLSpanElement | null = null;
	private updateTimer: number | null = null;
	private styleEl: HTMLLinkElement | null = null;

	async onload() {
		// --- Load plugin styles ---
		this.styleEl = document.createElement("link");
		this.styleEl.rel = "stylesheet";
		this.styleEl.type = "text/css";
		this.styleEl.href = this.app.vault.adapter.getResourcePath(
			this.manifest.dir + "/styles.css"
		);
		document.head.appendChild(this.styleEl);

		// --- Load settings and add settings tab ---
		await this.loadSettings();
		this.addSettingTab(new ProgressiveSettingTab(this.app, this));

		this.app.workspace.onLayoutReady(async () => {
			const fileExplorerLeaves = this.app.workspace.getLeavesOfType("file-explorer");
			if (!fileExplorerLeaves.length) return;

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
			await this.updateProgressBar();

			// --- File system event listeners ---
			this.registerEvent(this.app.vault.on("modify", () => this.debouncedUpdate()));
			this.registerEvent(this.app.vault.on("create", () => this.debouncedUpdate()));
			this.registerEvent(this.app.vault.on("delete", () => this.debouncedUpdate()));
			this.registerEvent(this.app.vault.on("rename", () => this.debouncedUpdate()));

			// --- Periodic update for folders ---
			this.registerInterval(
				window.setInterval(() => this.updateProgressBar(), 10000)
			);
		});
	}

	onunload() {
		if (this.progressBarContainer) this.progressBarContainer.remove();
		if (this.updateTimer) window.clearTimeout(this.updateTimer);

		// Clean up stylesheet
		if (this.styleEl && this.styleEl.parentNode) {
			this.styleEl.parentNode.removeChild(this.styleEl);
			this.styleEl = null;
		}
	}

	private debouncedUpdate() {
		if (this.updateTimer) window.clearTimeout(this.updateTimer);
		this.updateTimer = window.setTimeout(() => this.updateProgressBar(), 1000);
	}

	async updateProgressBar() {
		if (!this.settings.notePath) return;

		let filesToCheck: TFile[] = [];
		const target = this.app.vault.getAbstractFileByPath(this.settings.notePath);

		if (target instanceof TFile) {
			filesToCheck = [target];
		} else if (target instanceof TFolder) {
			filesToCheck = this.app.vault
				.getMarkdownFiles()
				.filter((f) => f.path.startsWith(this.settings.notePath + "/"));
		} else {
			filesToCheck = this.app.vault
				.getMarkdownFiles()
				.filter((f) => f.path.startsWith(this.settings.notePath));
		}

		if (!filesToCheck.length) return;

		const now = new Date();

		// --- Filter based on tracking mode ---
		if (this.settings.trackMode === "latest") {
			filesToCheck.sort((a, b) => b.stat.mtime - a.stat.mtime);
			filesToCheck = [filesToCheck[0]];
		} else if (this.settings.trackMode === "today" && !(target instanceof TFile)) {
			if (this.settings.noteType === "daily") {
				const todayStr = `${String(now.getDate()).padStart(2, "0")}-${String(
					now.getMonth() + 1
				).padStart(2, "0")}-${now.getFullYear()}`;
				filesToCheck = filesToCheck.filter((f) => f.basename.includes(todayStr));
			} else if (this.settings.noteType === "weekly") {
				const getISOWeek = (date: Date) => {
					const temp = new Date(date.getTime());
					temp.setHours(0, 0, 0, 0);
					temp.setDate(temp.getDate() + 4 - (temp.getDay() || 7));
					const yearStart = new Date(temp.getFullYear(), 0, 1);
					return Math.ceil(
						((temp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7
					);
				};
				const weekStr = `W${getISOWeek(now)}-${now.getFullYear()}`;
				filesToCheck = filesToCheck.filter((f) => f.basename.includes(weekStr));
			} else if (this.settings.noteType === "monthly") {
				const monthStr = `${String(now.getMonth() + 1).padStart(2, "0")}-${now.getFullYear()}`;
				filesToCheck = filesToCheck.filter((f) => f.basename.includes(monthStr));
			}
		}

		// --- Compute progress ---
		let totalTasks = 0;
		let doneTasks = 0;

		for (const f of filesToCheck) {
			const content = await this.app.vault.cachedRead(f);
			const uncheckedMatches = content.match(UNCHECKED_REGEX)?.length || 0;
			const checkedMatches = content.match(CHECKED_REGEX)?.length || 0;
			totalTasks += uncheckedMatches;
			doneTasks += checkedMatches;
		}

		const percent =
			totalTasks + doneTasks > 0
				? Math.round((doneTasks / (totalTasks + doneTasks)) * 100)
				: 0;

		this.updateBarUI(percent);
	}

	private updateBarUI(percent: number) {
		if (!this.progressBarFill || !this.progressPercentLabel) return;

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
		} else if (this.settings.colorMode === "bw") {
			const isDark = document.body.classList.contains("theme-dark");
			this.progressBarFill.style.backgroundColor = isDark ? "white" : "black";
		} else {
			this.progressBarFill.style.backgroundColor = "var(--interactive-accent)";
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
		await this.updateProgressBar();
	}
}

// --- Settings Tab ---
class ProgressiveSettingTab extends PluginSettingTab {
	plugin: ProgressivePlugin;

	constructor(app: App, plugin: ProgressivePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Track Note / Folder")
			.setDesc("Choose the note or folder to track")
			.addText((text) =>
				text
					.setPlaceholder("path/to/note/or/folder")
					.setValue(this.plugin.settings.notePath)
					.onChange(async (value) => {
						this.plugin.settings.notePath = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Note Type")
			.setDesc("Choose the note type to track")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("daily", "Daily")
					.addOption("weekly", "Weekly")
					.addOption("monthly", "Monthly")
					.addOption("custom", "Custom")
					.setValue(this.plugin.settings.noteType)
					.onChange(async (value) => {
						this.plugin.settings.noteType = value as any;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Tracking Mode")
			.setDesc("Which notes to include in progress")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("latest", "Latest note only")
					.addOption("today", "Today’s note only")
					.addOption("all", "All notes in folder")
					.setValue(this.plugin.settings.trackMode)
					.onChange(async (value) => {
						this.plugin.settings.trackMode = value as any;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Progress Bar Color Mode")
			.setDesc("Choose the color behavior of the progress bar")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("theme", "Theme accent color")
					.addOption("multicolor", "Multicolor scale")
					.addOption("bw", "Black/White (theme-based)")
					.setValue(this.plugin.settings.colorMode)
					.onChange(async (value) => {
						this.plugin.settings.colorMode = value as any;
						await this.plugin.saveSettings();
					})
			);
	}
}
