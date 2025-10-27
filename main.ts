import { App, FuzzySuggestModal, FuzzyMatch, Notice, Plugin, PluginSettingTab, Setting, MarkdownPostProcessorContext, requestUrl, TFile } from 'obsidian';

// --- HARVEST API TYPES ---

interface HarvestClient {
    id: number;
    name: string;
    currency: string;
}

interface HarvestUser {
    id: number;
    name: string;
}

interface HarvestProject {
    id: number;
    name: string;
    code: string;
}

interface HarvestTask {
    id: number;
    name: string;
}

interface HarvestUserAssignment {
    id: number;
    is_project_manager: boolean;
    is_active: boolean;
    use_default_rates: boolean;
    budget: number | null;
    created_at: string;
    updated_at: string;
    hourly_rate: number | null;
}

interface HarvestTaskAssignment {
    id: number;
    billable: boolean;
    is_active: boolean;
    created_at: string;
    updated_at: string;
    hourly_rate: number | null;
    budget: number | null;
    task: HarvestTask;
}

interface HarvestTimeEntry {
    id: number;
    spent_date: string;
    hours: number;
    hours_without_timer: number;
    rounded_hours: number;
    notes: string;
    is_locked: boolean;
    locked_reason: string | null;
    approval_status: string;
    is_closed: boolean;
    is_billed: boolean;
    timer_started_at: string | null;
    started_time: string | null;
    ended_time: string | null;
    is_running: boolean;
    billable: boolean;
    budgeted: boolean;
    billable_rate: number | null;
    cost_rate: number | null;
    created_at: string;
    updated_at: string;
    user: HarvestUser;
    client: HarvestClient;
    project: HarvestProject;
    task: HarvestTask;
    user_assignment: HarvestUserAssignment;
    task_assignment: Omit<HarvestTaskAssignment, 'task'>;
    invoice: unknown | null;
    external_reference: unknown | null;
}

interface HarvestProjectFull {
    id: number;
    name: string;
    code: string;
    is_active: boolean;
    is_billable: boolean;
    is_fixed_fee: boolean;
    bill_by: string;
    budget: number | null;
    budget_by: string;
    budget_is_monthly: boolean;
    notify_when_over_budget: boolean;
    over_budget_notification_percentage: number;
    show_budget_to_all: boolean;
    created_at: string;
    updated_at: string;
    starts_on: string;
    ends_on: string | null;
    over_budget_notification_date: string | null;
    notes: string | null;
    cost_budget: number | null;
    cost_budget_include_expenses: boolean;
    hourly_rate: number | null;
    fee: number | null;
    client: HarvestClient;
    task_assignments?: HarvestTaskAssignment[];
}

interface HarvestTimeEntriesResponse {
    time_entries: HarvestTimeEntry[];
    per_page: number;
    total_pages: number;
    total_entries: number;
    next_page: number | null;
    previous_page: number | null;
    page: number;
    links: {
        first: string;
        next: string | null;
        previous: string | null;
        last: string;
    };
}

interface HarvestProjectsResponse {
    projects: HarvestProjectFull[];
    per_page: number;
    total_pages: number;
    total_entries: number;
    next_page: number | null;
    previous_page: number | null;
    page: number;
    links: {
        first: string;
        next: string | null;
        previous: string | null;
        last: string;
    };
}

interface HarvestTaskAssignmentsResponse {
    task_assignments: HarvestTaskAssignment[];
    per_page: number;
    total_pages: number;
    total_entries: number;
    next_page: number | null;
    previous_page: number | null;
    page: number;
    links: {
        first: string;
        next: string | null;
        previous: string | null;
        last: string;
    };
}

interface HarvestCurrentUser {
    id: number;
    first_name: string;
    last_name: string;
    email: string;
}

// --- PLUGIN TYPES ---

// Stores the last used project/task for a given folder path.
interface FolderProjectCache {
    [folderPath: string]: {
        projectId: number;
        taskId: number;
    };
}

// --- HQL TYPES ---
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
function renderReport(container: HTMLElement, entries: HarvestTimeEntry[], query: HarvestQuery) {
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

function renderList(container: HTMLElement, entries: HarvestTimeEntry[]) {
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

function renderSummary(container: HTMLElement, entries: HarvestTimeEntry[]) {
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

    container.createEl('h3', { text: 'Time summary' });
    const summaryDiv = container.createDiv({ cls: 'harvest-summary' });
    summaryDiv.createEl('p').createEl('strong', { text: `Total hours: ${totalHours.toFixed(2)}` });

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
        bar.style.setProperty('--bar-width', `${percentage}%`);
        bar.style.setProperty('--bar-color', color);
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
        const hasStaticFlag = source.includes('--static');
        const querySource = source.replace('--static', '').trim();

        const query = parseQuery(querySource);
        if (!query) return;

        if (hasStaticFlag) {
            el.setText('Loading static Harvest report...');

            const entries = await plugin.getTimeEntries(query);
            if (!entries) {
                el.setText('Failed to fetch Harvest report.');
                return;
            }

            const tempDiv = document.createElement('div');
            renderReport(tempDiv, entries, query);
            const reportHTML = tempDiv.innerHTML;

            const replacementText = `<div class="harvest-static-container">
<details>
<summary>View static query</summary>
<pre><code>${source}</code></pre>
</details>
${reportHTML}
</div>`;

            const file = plugin.app.vault.getAbstractFileByPath(ctx.sourcePath);

            if (!(file instanceof TFile)) {
                el.setText('Error: Could not find file to write static report.');
                return;
            }

            const section = ctx.getSectionInfo(el);
            if (!section) {
                el.setText('Error: Could not read file section to write static report.');
                return;
            }

            const fileContent = await plugin.app.vault.read(file);
            const lines = fileContent.split('\n');
            
            const newLines = [
                ...lines.slice(0, section.lineStart),
                replacementText,
                ...lines.slice(section.lineEnd + 1)
            ];
            
            await plugin.app.vault.modify(file, newLines.join('\n'));
            return;
        }

        // Original dynamic logic
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
    folderProjectCache: FolderProjectCache;
}

// Default settings to be used if none are saved
const DEFAULT_SETTINGS: HarvestPluginSettings = {
    personalAccessToken: '',
    accountId: '',
    pollingInterval: 5, // Default to 5 minutes
    folderProjectCache: {}
}

// Main Plugin Class
export default class HarvestPlugin extends Plugin {
    settings: HarvestPluginSettings;
    statusBarItemEl: HTMLElement;
    runningTimer: HarvestTimeEntry | null = null;
    timerInterval: number;
    projectCache: HarvestProjectFull[] = []; // Cache for the combined project list
    userId: number | null = null;

    async onload() {
        await this.loadSettings();

        this.statusBarItemEl = this.addStatusBarItem();
        this.statusBarItemEl.setText('Harvest');
        this.statusBarItemEl.addClass('mod-clickable');
        this.statusBarItemEl.addEventListener('click', () => this.toggleTimer());

        this.addSettingTab(new HarvestSettingTab(this.app, this));

        if (this.settings.personalAccessToken && this.settings.accountId) {
            await this.fetchCurrentUserId();
        }

        // Warm up the project cache on startup
        this.fetchAllTrackableProjects();

        this.addCommand({
            id: 'start-harvest-timer',
            name: 'Start timer',
            callback: () => {
                new ProjectSuggestModal(this.app, this, this.app.workspace.getActiveFile()).open();
            }
        });

        this.addCommand({
            id: 'stop-harvest-timer',
            name: 'Stop timer',
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
            name: 'Toggle timer',
            callback: async () => {
                await this.toggleTimer();
            }
        });

        this.addCommand({
            id: 'refresh-harvest-projects',
            name: 'Refresh projects',
            callback: async () => {
                new Notice('Refreshing project list from Harvest...');
                await this.fetchAllTrackableProjects(true); // Force a refresh
                new Notice('Project list has been updated.');
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

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    async request<T = unknown>(
        endpoint: string, 
        method: string = 'GET', 
        body: Record<string, unknown> | null = null
    ): Promise<T | null> {
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
            const response = await requestUrl({
                url: `https://api.harvestapp.com/v2${endpoint}`,
                method: method,
                headers: headers,
                body: body ? JSON.stringify(body) : undefined
            });

            if (response.status >= 400) {
                new Notice(`Harvest API error: ${response.json.message || response.status}`);
                return null;
            }
            return response.json as T;
        } catch (error) {
            new Notice('Failed to connect to Harvest API.');
            console.error('Harvest API request error:', error);
            return null;
        }
    }

    async fetchCurrentUserId() {
        const me = await this.request<HarvestCurrentUser>('/users/me');
        if (me && me.id) {
            this.userId = me.id;
        } else {
            this.userId = null;
            new Notice('Could not retrieve Harvest User ID.');
            console.error('Failed to fetch Harvest User ID.');
        }
    }
    
    async getTimeEntries(query: HarvestQuery): Promise<HarvestTimeEntry[]> {
        if (!this.userId) {
            new Notice('Harvest User ID not found. Cannot fetch your time entries.');
            return [];
        }
        const endpoint = `/time_entries?from=${query.from}&to=${query.to}&user_id=${this.userId}`;
        const data = await this.request<HarvestTimeEntriesResponse>(endpoint);
        if (data && data.time_entries) {
            return data.time_entries;
        }
        return [];
    }

    async fetchAllTrackableProjects(forceRefresh: boolean = false): Promise<HarvestProjectFull[]> {
        if (this.projectCache.length > 0 && !forceRefresh) {
            return this.projectCache;
        }

        const managedProjects = await this.getManagedProjects();
        const recentProjects = await this.getRecentProjectsFromTimeEntries();
        const combinedProjectMap = new Map<number, HarvestProjectFull>();
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

    async getManagedProjects(): Promise<HarvestProjectFull[]> {
        let allProjects: HarvestProjectFull[] = [];
        let page = 1;
        let totalPages = 1;
        do {
            const data = await this.request<HarvestProjectsResponse>(`/projects?is_active=true&page=${page}`);
            if (data && data.projects) {
                allProjects = allProjects.concat(data.projects);
                totalPages = data.total_pages;
                page++;
            } else { break; }
        } while (page <= totalPages);
        return allProjects;
    }

    async getRecentProjectsFromTimeEntries(): Promise<HarvestProjectFull[]> {
        if (!this.userId) return [];
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const fromDate = thirtyDaysAgo.toISOString().split('T')[0];
        const data = await this.request<HarvestTimeEntriesResponse>(`/time_entries?from=${fromDate}&user_id=${this.userId}`);
        if (!data || !data.time_entries) return [];
        const recentProjectsMap = new Map<number, HarvestProjectFull>();
        data.time_entries.forEach((entry: HarvestTimeEntry) => {
            if (entry.project && !recentProjectsMap.has(entry.project.id)) {
                // Convert the simplified project from time entry to HarvestProjectFull
                recentProjectsMap.set(entry.project.id, entry.project as unknown as HarvestProjectFull);
            }
        });
        return Array.from(recentProjectsMap.values());
    }
    
    async startTimer(projectId: number, taskId: number, activeFile: TFile | null) {
        // Save the selected project/task to the cache for the current folder
        if (activeFile && activeFile.parent) {
            const folderPath = activeFile.parent.path;
            this.settings.folderProjectCache[folderPath] = { projectId, taskId };
            await this.saveSettings();
        }

        const today = new Date();
        const year = today.getFullYear();
        const month = (today.getMonth() + 1).toString().padStart(2, '0');
        const day = today.getDate().toString().padStart(2, '0');
        const spentDate = `${year}-${month}-${day}`;

        // Check for existing entry today for this project/task to restart it
        if (this.userId) {
            const data = await this.request<HarvestTimeEntriesResponse>(`/time_entries?from=${spentDate}&to=${spentDate}&user_id=${this.userId}`);
            if (data && data.time_entries) {
                const existingEntry = data.time_entries.find(
                    (entry: HarvestTimeEntry) => entry.project.id === projectId && entry.task.id === taskId
                );
                
                if (existingEntry) {
                    const result = await this.request(`/time_entries/${existingEntry.id}/restart`, 'PATCH');
                    if (result) {
                        new Notice('Timer restarted!');
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
            new Notice('Timer started!');
            this.updateRunningTimer();
        }
    }

    async updateRunningTimer() {
        if (!this.userId) return;
        const data = await this.request<HarvestTimeEntriesResponse>(`/time_entries?is_running=true&user_id=${this.userId}`);
        if (data && data.time_entries && data.time_entries.length > 0) {
            this.runningTimer = data.time_entries[0];
            const { project, task, hours } = this.runningTimer;
            this.statusBarItemEl.setText(`Harvest: ${project.name} - ${task.name} (${hours.toFixed(2)}h)`);
        } else {
            this.runningTimer = null;
            this.statusBarItemEl.setText('Harvest: no timer running');
        }
    }

    async stopTimer(timerId: number) {
        const result = await this.request(`/time_entries/${timerId}/stop`, 'PATCH');
        if (result) {
            new Notice('Timer stopped.');
            this.updateRunningTimer();
        }
    }

    async toggleTimer() {
        await this.updateRunningTimer();
        if (this.runningTimer) {
            new Notice('Stopping timer...');
            await this.stopTimer(this.runningTimer.id);
        } else {
            new Notice('No timer running. Starting a new one...');
            new ProjectSuggestModal(this.app, this, this.app.workspace.getActiveFile()).open();
        }
    }
}

// -- MODAL CLASSES --

class ProjectSuggestModal extends FuzzySuggestModal<HarvestProjectFull> {
    plugin: HarvestPlugin;
    activeFile: TFile | null;

    constructor(app: App, plugin: HarvestPlugin, activeFile: TFile | null) {
        super(app);
        this.plugin = plugin;
        this.activeFile = activeFile;
    }

    getItems(): HarvestProjectFull[] {
        let projects = [...this.plugin.projectCache]; // Create a mutable copy
        
        if (this.activeFile && this.activeFile.parent) {
            const folderPath = this.activeFile.parent.path;
            const cachedInfo = this.plugin.settings.folderProjectCache[folderPath];
            
            if (cachedInfo) {
                const cachedProjectIndex = projects.findIndex(p => p.id === cachedInfo.projectId);
                
                if (cachedProjectIndex > -1) {
                    // Move the cached project to the front of the list to pre-select it
                    const cachedProject = projects.splice(cachedProjectIndex, 1)[0];
                    projects.unshift(cachedProject);
                }
            }
        }
        
        return projects;
    }

    getItemText(project: HarvestProjectFull): string {
        return project.name;
    }

    renderSuggestion(match: FuzzyMatch<HarvestProjectFull>, el: HTMLElement) {
        const project = match.item;
        el.createEl('div', { text: project.name });
        el.createEl('small', { text: project.client?.name || 'No client' });
    }

    async onChooseItem(project: HarvestProjectFull) {
        let tasks = project.task_assignments;
        if (!tasks) {
            const data = await this.plugin.request<HarvestTaskAssignmentsResponse>(`/projects/${project.id}/task_assignments`);
            tasks = data?.task_assignments;
        }

        if (tasks && tasks.length > 0) {
            new TaskSuggestModal(this.app, this.plugin, project, tasks, this.activeFile).open();
        } else {
            new Notice('No tasks found for this project.');
        }
    }
}

class TaskSuggestModal extends FuzzySuggestModal<HarvestTaskAssignment> {
    plugin: HarvestPlugin;
    project: HarvestProjectFull;
    tasks: HarvestTaskAssignment[];
    activeFile: TFile | null;

    constructor(app: App, plugin: HarvestPlugin, project: HarvestProjectFull, tasks: HarvestTaskAssignment[], activeFile: TFile | null) {
        super(app);
        this.plugin = plugin;
        this.project = project;
        this.tasks = tasks;
        this.activeFile = activeFile;
    }

    getItems(): HarvestTaskAssignment[] {
        let tasks = [...this.tasks]; // Create a mutable copy

        if (this.activeFile && this.activeFile.parent) {
            const folderPath = this.activeFile.parent.path;
            const cachedInfo = this.plugin.settings.folderProjectCache[folderPath];

            // Check if the cache is for the currently selected project
            if (cachedInfo && cachedInfo.projectId === this.project.id) {
                const cachedTaskIndex = tasks.findIndex(t => t.task.id === cachedInfo.taskId);
                
                if (cachedTaskIndex > -1) {
                    // Move the cached task to the front of the list to pre-select it
                    const cachedTask = tasks.splice(cachedTaskIndex, 1)[0];
                    tasks.unshift(cachedTask);
                }
            }
        }
        
        return tasks;
    }

    getItemText(taskAssignment: HarvestTaskAssignment): string {
        return taskAssignment.task.name;
    }
    
    renderSuggestion(match: FuzzyMatch<HarvestTaskAssignment>, el: HTMLElement) {
        el.createEl("div", { text: match.item.task.name });
    }

    onChooseItem(taskAssignment: HarvestTaskAssignment) {
        this.plugin.startTimer(this.project.id, taskAssignment.task.id, this.activeFile);
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
        new Setting(containerEl).setName('Harvest integration settings').setHeading();
        new Setting(containerEl)
            .setName('Personal access token')
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
            .setName('Polling interval')
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
