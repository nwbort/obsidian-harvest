import { App, FuzzySuggestModal, FuzzyMatch, Notice, Plugin, PluginSettingTab, Setting, MarkdownPostProcessorContext } from 'obsidian';

// --- HQL (Harvest Query Language) TYPES ---
type ISODate = string;

enum QueryType {
    SUMMARY = 'SUMMARY',
    LIST = 'LIST',
}

interface HarvestQuery {
    type: QueryType;
    from: ISODate;
    to: ISODate;
}

// --- HQL PARSER ---
function parseQuery(source: string): HarvestQuery {
    const tokens = source.trim().split(/\s+/).map(t => t.toUpperCase());
    if (tokens.length < 2) throw new Error("Query is too short.");

    const type = tokens[0] as QueryType;
    if (type !== QueryType.LIST && type !== QueryType.SUMMARY) {
        throw new Error(`Invalid query type: ${type}. Must be LIST or SUMMARY.`);
    }

    const { from, to } = parseTimeRange(tokens.slice(1));

    return { type, from, to };
}

function parseTimeRange(tokens: string[]): { from: ISODate, to: ISODate } {
    const today = new Date();
    const formatDate = (date: Date): ISODate => {
        const year = date.getFullYear();
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const day = date.getDate().toString().padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    let from: Date;
    let to: Date;

    switch (tokens[0]) {
        case 'TODAY':
            from = today;
            to = today;
            break;
        case 'WEEK':
            const dayOfWeek = today.getDay();
            const firstDayOfWeek = new Date(today.setDate(today.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1))); // Monday as first day
            from = firstDayOfWeek;
            to = new Date(new Date(firstDayOfWeek).setDate(firstDayOfWeek.getDate() + 6));
            break;
        case 'MONTH':
            from = new Date(today.getFullYear(), today.getMonth(), 1);
            to = new Date(today.getFullYear(), today.getMonth() + 1, 0);
            break;
        case 'PAST':
            const count = parseInt(tokens[1]);
            if (isNaN(count) || tokens[2] !== 'DAYS') throw new Error("Invalid PAST format. Use 'PAST <number> DAYS'.");
            to = today;
            from = new Date(new Date().setDate(today.getDate() - (count - 1)));
            break;
        case 'FROM':
            if (tokens.length < 4 || tokens[2] !== 'TO') throw new Error("Invalid FROM...TO format.");
            from = new Date(tokens[1]);
            to = new Date(tokens[3]);
            if (isNaN(from.getTime()) || isNaN(to.getTime())) throw new Error("Invalid date format in FROM...TO. Use YYYY-MM-DD.");
            break;
        default:
            throw new Error(`Unknown time range specifier: ${tokens[0]}`);
    }

    return { from: formatDate(from), to: formatDate(to) };
}

// --- HQL RENDERER ---
function renderReport(container: HTMLElement, entries: any[], query: HarvestQuery) {
    container.empty();
    const wrapper = container.createDiv({ cls: 'harvest-report' });

    if (entries.length === 0) {
        wrapper.createEl('p', { text: 'No time entries found for the selected period.' });
        return;
    }

    if (query.type === QueryType.LIST) {
        renderList(wrapper, entries);
    } else if (query.type === QueryType.SUMMARY) {
        renderSummary(wrapper, entries);
    }
}

function renderList(container: HTMLElement, entries: any[]) {
    const table = container.createEl('table', { cls: 'harvest-table' });
    const thead = table.createTHead();
    const headerRow = thead.insertRow();
    headerRow.createEl('th', { text: 'Project' });
    headerRow.createEl('th', { text: 'Task' });
    headerRow.createEl('th', { text: 'Date' });
    headerRow.createEl('th', { text: 'Hours' });

    const tbody = table.createTBody();
    for (const entry of entries) {
        const row = tbody.insertRow();
        row.createEl('td', { text: entry.project.name });
        row.createEl('td', { text: entry.task.name });
        row.createEl('td', { text: entry.spent_date });
        row.createEl('td', { text: entry.hours.toFixed(2), cls: 'harvest-hours' });
    }
}

function renderSummary(container: HTMLElement, entries: any[]) {
    let totalHours = 0;
    const projectTotals: { [key: string]: number } = {};

    for (const entry of entries) {
        totalHours += entry.hours;
        const projectName = entry.project.name;
        if (!projectTotals[projectName]) {
            projectTotals[projectName] = 0;
        }
        projectTotals[projectName] += entry.hours;
    }

    container.createEl('h3', { text: 'Time Summary' });
    const summaryDiv = container.createDiv({ cls: 'harvest-summary' });
    summaryDiv.createEl('p').createEl('strong', { text: `Total Hours: ${totalHours.toFixed(2)}` });

    // Bar Chart
    const barChartContainer = summaryDiv.createDiv({ cls: 'harvest-barchart-container' });
    const colors = ['#84b65a', '#c25956', '#59a7c2', '#c29b59', '#8e59c2', '#c2598e', '#5ac28a'];
    let colorIndex = 0;
    
    const sortedProjects = Object.keys(projectTotals).sort((a, b) => projectTotals[b] - projectTotals[a]);

    for (const projectName of sortedProjects) {
        const projectHours = projectTotals[projectName];
        const percentage = totalHours > 0 ? (projectHours / totalHours) * 100 : 0;
        const color = colors[colorIndex % colors.length];

        const bar = barChartContainer.createDiv({ cls: 'harvest-barchart-bar' });
        bar.style.width = `${percentage}%`;
        bar.style.backgroundColor = color;
        bar.title = `${projectName}: ${projectHours.toFixed(2)} hours`;
        colorIndex++;
    }

    // Legend
    const legendContainer = summaryDiv.createDiv({ cls: 'harvest-barchart-legend' });
    colorIndex = 0;
    for (const projectName of sortedProjects) {
        const projectHours = projectTotals[projectName];
        const color = colors[colorIndex % colors.length];

        const legendItem = legendContainer.createDiv({ cls: 'harvest-legend-item' });
        const colorSwatch = legendItem.createDiv({ cls: 'harvest-legend-swatch' });
        colorSwatch.style.backgroundColor = color;
        legendItem.createSpan({ text: `${projectName}: ${projectHours.toFixed(2)} hours` });
        colorIndex++;
    }
}


// --- HQL PROCESSOR ---
const hqlProcessor = (plugin: HarvestPlugin) => async (
    source: string,
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext
) => {
    try {
        const query = parseQuery(source);
        if (!query) return;

        el.setText('Loading Harvest report...');

        const entries = await plugin.getTimeEntries(query);

        if (entries) {
            renderReport(el, entries, query);
        } else {
            el.setText('Failed to fetch Harvest report.');
        }
    } catch (e) {
        el.setText(`Error processing Harvest query: ${e.message}`);
    }
};


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
    userId: number | null = null;

    async onload() {
        await this.loadSettings();

        this.addReportStyles();

        this.statusBarItemEl = this.addStatusBarItem();
        this.statusBarItemEl.setText('Harvest');

        this.addSettingTab(new HarvestSettingTab(this.app, this));

        if (this.settings.personalAccessToken && this.settings.accountId) {
            await this.fetchCurrentUserId();
        }

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
            id: 'toggle-harvest-timer',
            name: 'Toggle Harvest Timer (Start if stopped, Stop if started)',
            callback: async () => {
                await this.updateRunningTimer();
                if (this.runningTimer) {
                    new Notice('Stopping Harvest timer...');
                    await this.stopTimer(this.runningTimer.id);
                } else {
                    new Notice('No timer running. Starting a new one...');
                    new ProjectSuggestModal(this.app, this).open();
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

        // Register HQL code block processor
        this.registerMarkdownCodeBlockProcessor('harvest', hqlProcessor(this));

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

    addReportStyles() {
        const css = `
            .harvest-report h3 { margin-bottom: 0.5em; }
            .harvest-barchart-container { display: flex; width: 100%; height: 20px; border-radius: 3px; overflow: hidden; margin-bottom: 1em; }
            .harvest-barchart-bar { height: 100%; }
            .harvest-barchart-legend { display: flex; flex-direction: column; gap: 0.5em; }
            .harvest-legend-item { display: flex; align-items: center; }
            .harvest-legend-swatch { width: 12px; height: 12px; margin-right: 8px; border-radius: 2px; }
            .harvest-table { width: 100%; border-collapse: collapse; }
            .harvest-table th, .harvest-table td { padding: 8px; border: 1px solid var(--background-modifier-border); text-align: left; }
            .harvest-table th { font-weight: bold; }
            .harvest-hours { text-align: right; }
        `;
        const styleEl = document.createElement('style');
        styleEl.id = 'obsidian-harvest-report-styles';
        styleEl.innerHTML = css;
        document.head.appendChild(styleEl);
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

    async fetchCurrentUserId() {
        const me = await this.request('/users/me');
        if (me && me.id) {
            this.userId = me.id;
        } else {
            this.userId = null;
            new Notice('Could not retrieve Harvest User ID.');
            console.error('Failed to fetch Harvest User ID.');
        }
    }
    
    async getTimeEntries(query: HarvestQuery): Promise<any[]> {
        if (!this.userId) {
            new Notice('Harvest User ID not found. Cannot fetch your time entries.');
            return [];
        }
        const endpoint = `/time_entries?from=${query.from}&to=${query.to}&user_id=${this.userId}`;
        const data = await this.request(endpoint);
        if (data && data.time_entries) {
            return data.time_entries;
        }
        return [];
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
        if (!this.userId) return [];
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const fromDate = thirtyDaysAgo.toISOString().split('T')[0];
        const data = await this.request(`/time_entries?from=${fromDate}&user_id=${this.userId}`);
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
    const today = new Date();
    const year = today.getFullYear();
    const month = (today.getMonth() + 1).toString().padStart(2, '0');
    const day = today.getDate().toString().padStart(2, '0');
    const spentDate = `${year}-${month}-${day}`;

    // Check for existing entry today for this project/task
    if (this.userId) {
        const data = await this.request(`/time_entries?from=${spentDate}&to=${spentDate}&user_id=${this.userId}`);
        if (data && data.time_entries) {
            const existingEntry = data.time_entries.find(
                (entry: any) => entry.project.id === projectId && entry.task.id === taskId
            );
            
            if (existingEntry) {
                // Restart the existing entry
                const result = await this.request(`/time_entries/${existingEntry.id}/restart`, 'PATCH');
                if (result) {
                    new Notice('Harvest timer restarted!');
                    this.updateRunningTimer();
                }
                return;
            }
        }
    }

    // No existing entry found, create a new one
    const body = {
        project_id: projectId,
        task_id: taskId,
        spent_date: spentDate,
    };
    const result = await this.request('/time_entries', 'POST', body);
    if (result) {
        new Notice('Harvest timer started!');
        this.updateRunningTimer();
    }
}

    async updateRunningTimer() {
        if (!this.userId) return;
        const data = await this.request(`/time_entries?is_running=true&user_id=${this.userId}`);
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
                    if (this.plugin.settings.accountId) {
                        await this.plugin.fetchCurrentUserId();
                    }
                }));
        new Setting(containerEl)
            .setName('Account ID')
            .setDesc('You can also find this on the same page as your token.')
            .addText(text => text.setPlaceholder('Enter your Account ID').setValue(this.plugin.settings.accountId)
                .onChange(async (value) => {
                    this.plugin.settings.accountId = value;
                    await this.plugin.saveSettings();
                    if (this.plugin.settings.personalAccessToken) {
                        await this.plugin.fetchCurrentUserId();
                    }
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