# Obsidian Harvest integration

![GitHub license](https://img.shields.io/github/license/nwbort/obsidian-harvest)

Integrates [Harvest](https://www.getharvest.com/) time tracking directly into your [Obsidian.md](https://obsidian.md) workspace. Start, stop, and view your running timers without ever leaving your notes.

## Features

*   **Status bar integration:** See your currently running Harvest timer, including the project, task, and duration, right in the Obsidian status bar.
*   **Start & stop timers:** Use Obsidian's command palette to quickly start and stop your timers.
*   **Time reports:** Generate and view reports of your time entries directly within your notes using a simple query language.

## How to install

### From the Community plugins tab in Obsidian

1.  Go to `Settings` -> `Community plugins`.
2.  Make sure "Safe mode" is turned **off**.
3.  Click `Browse` and search for "Harvest".
4.  Click `Install`.
5.  Once installed, find the plugin in your list and `Enable` it.

### Manual installation

1.  Download the `main.js`, `manifest.json` from the [latest release](https://github.com/nwbort/obsidian-harvest/releases).
2.  Navigate to your Obsidian vault's plugin folder: `<YourVault>/.obsidian/plugins/`.
3.  Create a new folder named `harvest`.
4.  Move the downloaded files into this new folder.
5.  Reload Obsidian.
6.  Go to `Settings` -> `Community plugins`, find "Harvest", and enable it.

## How to Use

### 1. Configuration

Before you can use the plugin, you must configure your Harvest API credentials.

1.  **Get your credentials from Harvest:**
    *   Navigate to your [Harvest ID Developers page](https://id.getharvest.com/developers).
    *   Create a new **Personal Access Token**.
    *   Copy the **Token** and your **Account ID**.

2.  **Enter your credentials in Obsidian:**
    *   Go to `Settings` -> `Community Plugin Options` -> `Harvest`.
    *   Paste your **Personal Access Token** and **Account ID** into the respective fields.

### 2. Commands

Access these commands through the command palette (`Ctrl/Cmd + P`):

*   **Start Harvest Timer:**
    *   This command will open a modal to search for a project.
    *   After selecting a project, a second modal will appear to select a task.
    *   Once a task is chosen, the timer will start immediately.
*   **Stop Harvest Timer:**
    *   If a timer is running, this command will stop it.
    *   A notification will confirm that the timer has been stopped.
*   **Refresh Harvest Projects:**
    *   Use this command to manually update the list of projects from your Harvest account.

### 3. Rendering time reports with HQL

You can render time tracking reports directly inside your notes using `harvest` code blocks. This uses a simple Harvest Query Language (HQL).

#### How it works

Create a code block with the language identifier `harvest`.

**List report**

To get a list of your time entries for a specific period:

````
```harvest
LIST TODAY
```
````

````
```harvest
LIST PAST 7 DAYS
```
````

**Summary report**

To get a summary of hours tracked per project for a specific period:

````
```harvest
SUMMARY WEEK
```
````

````
```harvest
SUMMARY FROM 2025-01-01 TO 2025-01-31
```
````

#### Supported syntax

**Query types:**
*   `LIST`: Shows a detailed list of individual time entries.
*   `SUMMARY`: Shows total hours and a breakdown by project.

**Time ranges:**
*   `TODAY`
*   `WEEK` (This week, Monday to Sunday)
*   `MONTH` (This calendar month)
*   `PAST <number> DAYS` (e.g., `PAST 14 DAYS`)
*   `FROM <YYYY-MM-DD> TO <YYYY-MM-DD>`


### 4. Status bar

The status bar item at the bottom of your Obsidian window provides at-a-glance information:
*   **No timer running:** Displays "Harvest: No timer running".
*   **Timer active:** Displays the format `Harvest: <Project Name> - <Task Name> (X.XXh)`. This will update periodically based on your polling interval settings.

## Settings

| Setting                 | Description                                                                                               |
| ----------------------- | --------------------------------------------------------------------------------------------------------- |
| **Personal Access Token** | Your unique token for accessing the Harvest API.                                                          |
| **Account ID**            | The ID of your Harvest account.                                                                           |
| **Polling Interval**      | How often (in minutes) the plugin should check for a running timer to update the status bar. Default is 5. |

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## See also

Inspiration for this plugin comes from the [Toggl Track plugin](https://github.com/mcndt/obsidian-toggl-integration).
