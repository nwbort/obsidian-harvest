import { App, FuzzySuggestModal, FuzzyMatch, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';

// Define the structure for our plugin's settings
interface HarvestPluginSettings {
    personalAccessToken: string;
    accountId: string;
    pollingInterval: number;
}

// Default settings to be used if none are saved
const DEFAULT_SETTINGS: HarvestPluginSettings = {
    personalAccessToken: '',
    accountId: '',
    pollingInterval: 5 // Default to 5 minutes
}

// Main Plugin Class
export default class HarvestPlugin extends Plugin {
    settings: HarvestPluginSettings;
    statusBarItemEl: HTMLElement;
    runningTimer: any = null;
    timerInterval: number;
    projectCache: any[] = []; // Cache for the combined project list

    async onload() {
        await this.loadSettings();

        this.statusBarItemEl = this.addStatusBarItem();
        this.statusBarItemEl.setText('Harvest');

        this.addSettingTab(new HarvestSettingTab(this.app, this));

        // Warm up the project cache on startup
        this.fetchAllTrackableProjects();

        this.addCommand({
            id: 'start-harvest-timer',
            name: 'Start Harvest Timer',
            callback: () => {
                new ProjectSuggestModal(this.app, this).open();
            }
        });

        this.addCommand({
            id: 'stop-harvest-timer',
            name: 'Stop Harvest Timer',
            callback: async () => {
                if (this.runningTimer) {
                    await this.stopTimer(this.runningTimer.id);
                } else {
                    new Notice('No timer is currently running.');
                }
            }
        });

        this.addCommand({
            id: 'refresh-harvest-projects',
            name: 'Refresh Harvest Projects',
            callback: async () => {
                new Notice('Refreshing project list from Harvest...');
                await this.fetchAllTrackableProjects(true); // Force a refresh
                new Notice('Harvest project list has been updated.');
            }
        });

        // Use the polling interval from settings
        const pollingMinutes = this.settings.pollingInterval > 0 ? this.settings.pollingInterval : 5;
        this.timerInterval = window.setInterval(() => this.updateRunningTimer(), pollingMinutes * 60 * 1000);
        
        this.updateRunningTimer();
    }

    onunload() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
        }
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    async request(endpoint: string, method: string = 'GET', body: any = null) {
        if (!this.settings.personalAccessToken || !this.settings.accountId) {
            new Notice('Harvest API credentials are not set.');
            return null;
        }
        const headers = {
            'Authorization': `Bearer ${this.settings.personalAccessToken}`,
            'Harvest-Account-Id': this.settings.accountId,
            'User-Agent': 'Obsidian Harvest Integration',
            'Content-Type': 'application/json'
        };
        try {
            const response = await fetch(`https://api.harvestapp.com/v2${endpoint}`, {
                method: method,
                headers: headers,
                body: body ? JSON.stringify(body) : null
            });
            if (!response.ok) {
                const errorData = await response.json();
                new Notice(`Harvest API Error: ${errorData.message || response.statusText}`);
                return null;
            }
            return response.json();
        } catch (error) {
            new Notice('Failed to connect to Harvest API.');
            console.error('Harvest API request error:', error);
            return null;
        }
    }

    async fetchAllTrackableProjects(forceRefresh: boolean = false): Promise<any[]> {
        if (this.projectCache.length > 0 && !forceRefresh) {
            return this.projectCache;
        }

        const managedProjects = await this.getManagedProjects();
        const recentProjects = await this.getRecentProjectsFromTimeEntries();
        const combinedProjectMap = new Map<number, any>();
        managedProjects.forEach(proj => combinedProjectMap.set(proj.id, proj));
        recentProjects.forEach(proj => {
            if (!combinedProjectMap.has(proj.id)) {
                combinedProjectMap.set(proj.id, proj);
            }
        });
        const sortedProjects = Array.from(combinedProjectMap.values()).sort((a, b) => a.name.localeCompare(b.name));
        this.projectCache = sortedProjects;
        return this.projectCache;
    }

    async getManagedProjects(): Promise<any[]> {
        let allProjects: any[] = [];
        let page = 1;
        let totalPages = 1;
        do {
            const data = await this.request(`/projects?is_active=true&page=${page}`);
            if (data && data.projects) {
                allProjects = allProjects.concat(data.projects);
                totalPages = data.total_pages;
                page++;
            } else { break; }
        } while (page <= totalPages);
        return allProjects;
    }

    async getRecentProjectsFromTimeEntries(): Promise<any[]> {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const fromDate = thirtyDaysAgo.toISOString().split('T')[0];
        const data = await this.request(`/time_entries?from=${fromDate}`);
        if (!data || !data.time_entries) return [];
        const recentProjectsMap = new Map<number, any>();
        data.time_entries.forEach((entry: any) => {
            if (entry.project && !recentProjectsMap.has(entry.project.id)) {
                recentProjectsMap.set(entry.project.id, entry.project);
            }
        });
        return Array.from(recentProjectsMap.values());
    }
    
    async startTimer(projectId: number, taskId: number) {
        const body = {
            project_id: projectId,
            task_id: taskId,
            spent_date: new Date().toISOString().slice(0, 10),
        };
        const result = await this.request('/time_entries', 'POST', body);
        if (result) {
            new Notice('Harvest timer started!');
            this.updateRunningTimer();
        }
    }

    async updateRunningTimer() {
        const data = await this.request('/time_entries?is_running=true');
        if (data && data.time_entries && data.time_entries.length > 0) {
            this.runningTimer = data.time_entries[0];
            const { project, task, hours } = this.runningTimer;
            this.statusBarItemEl.setText(`Harvest: ${project.name} - ${task.name} (${hours.toFixed(2)}h)`);
        } else {
            this.runningTimer = null;
            this.statusBarItemEl.setText('Harvest: No timer running');
        }
    }

    async stopTimer(timerId: number) {
        const result = await this.request(`/time_entries/${timerId}/stop`, 'PATCH');
        if (result) {
            new Notice('Harvest timer stopped.');
            this.updateRunningTimer();
        }
    }
}

// -- MODAL CLASSES --

class ProjectSuggestModal extends FuzzySuggestModal<any> {
    plugin: HarvestPlugin;

    constructor(app: App, plugin: HarvestPlugin) {
        super(app);
        this.plugin = plugin;
    }

    getItems(): any[] {
        return this.plugin.projectCache;
    }

    getItemText(project: any): string {
        return project.name;
    }

    renderSuggestion(match: FuzzyMatch<any>, el: HTMLElement) {
        const project = match.item;
        el.createEl('div', { text: project.name });
        el.createEl('small', { text: project.client?.name || 'No Client' });
    }

    async onChooseItem(project: any) {
        let tasks = project.task_assignments;
        if (!tasks) {
            const data = await this.plugin.request(`/projects/${project.id}/task_assignments`);
            tasks = data?.task_assignments;
        }

        if (tasks && tasks.length > 0) {
            new TaskSuggestModal(this.app, this.plugin, project, tasks).open();
        } else {
            new Notice('No tasks found for this project.');
        }
    }
}

class TaskSuggestModal extends FuzzySuggestModal<any> {
    plugin: HarvestPlugin;
    project: any;
    tasks: any[];

    constructor(app: App, plugin: HarvestPlugin, project: any, tasks: any[]) {
        super(app);
        this.plugin = plugin;
        this.project = project;
        this.tasks = tasks;
    }

    getItems(): any[] {
        return this.tasks;
    }

    getItemText(taskAssignment: any): string {
        return taskAssignment.task.name;
    }
    
    renderSuggestion(match: FuzzyMatch<any>, el: HTMLElement) {
        el.createEl("div", { text: match.item.task.name });
    }

    onChooseItem(taskAssignment: any) {
        this.plugin.startTimer(this.project.id, taskAssignment.task.id);
    }
}

// -- SETTINGS TAB CLASS --

class HarvestSettingTab extends PluginSettingTab {
    plugin: HarvestPlugin;
    constructor(app: App, plugin: HarvestPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }
    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl('h2', { text: 'Harvest Integration Settings' });
        new Setting(containerEl)
            .setName('Personal Access Token')
            .setDesc('Get this from the Developers section of your Harvest ID.')
            .addText(text => text.setPlaceholder('Enter your token').setValue(this.plugin.settings.personalAccessToken)
                .onChange(async (value) => {
                    this.plugin.settings.personalAccessToken = value;
                    await this.plugin.saveSettings();
                }));
        new Setting(containerEl)
            .setName('Account ID')
            .setDesc('You can also find this on the same page as your token.')
            .addText(text => text.setPlaceholder('Enter your Account ID').setValue(this.plugin.settings.accountId)
                .onChange(async (value) => {
                    this.plugin.settings.accountId = value;
                    await this.plugin.saveSettings();
                }));
        
        new Setting(containerEl)
            .setName('Polling Interval')
            .setDesc('How often to check for a running timer, in minutes. Requires a reload to take effect.')
            .addText(text => text
                .setPlaceholder('Default: 5')
                .setValue(String(this.plugin.settings.pollingInterval))
                .onChange(async (value) => {
                    const interval = parseInt(value);
                    if (!isNaN(interval) && interval > 0) {
                        this.plugin.settings.pollingInterval = interval;
                        await this.plugin.saveSettings();
                    }
                }));
    }
}