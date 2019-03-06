'use strict';

const { exec } = require('child_process');

/**
 * Mangle taskwarrior's delimiter-less ISO 8601 format into one Date.parse can
 * handle, and pass it to Date.parse, returning a milliseconds-since-epoch TS.
 */
function parseTaskDate(iso) {
  return Date.parse(
    `${iso.slice(0,4)}-${iso.slice(4,6)}-${iso.slice(6,11)}:${iso.slice(11,13)}:${iso.slice(13,16)}`
  );
}

/**
 * Number of tasks that should be on a page when providing paged results.  For
 * now this is 16 because the standard grid picker is assumed, but it's likely
 * that this will want to be reduced to 8 in order to provide more screen real
 * estate.
 */
const TASKS_PER_PAGE = 16;

/**
 * Track and switch between TaskWarrior tasks and associate / lookup metadata
 * stored in the tasks.
 *
 * ## General Operation
 *
 * We have multiple
 */
class TaskManager {
  constructor({ log }) {
    if (!log) {
      throw new Error("GIVE ME A LOG");
    }
    this.log = log;

    this._lastExported = 0;
    /**
     * If non-null, the most recent task data we have, captured at the timestamp
     * saved in `_lastExported`.  Exists to avoid spamming the task warrior
     * process too much.
     */
    this._recentPending = null;
    /**
     * Simple/hacky mechanism to avoid having multiple getRecentPending exports
     * runnning under the hood.  If this is non-null, it's the promise of a call
     * to _runExport to get the current pending requests.
     */
    this._activePendingRequest = null;

    /**
     * This is always the currently active task (that is, the most recently
     * started task).  We always update this whenever we get an updated list of
     * pending tasks.
     *
     * Consumers that want an accurate answer and can wait for an async lookup
     * should use `getActiveTask`.  Consumers that just want the most-recent
     * value can use this, but ideally should kick-off a call to getActiveTask()
     * so that the next re-paint or whatever can have the right answer.
     */
    this.activeTask = null;
  }

  /**
   * Run "task export" with the provided arguments string.  This currently goes
   * through a shell.
   */
  _runExport(argStr) {
    return new Promise((resolve, reject) => {
      const cmdStr = 'task ' + argStr;
      exec(cmdStr, (err, stdout, stderr) => {
        if (err) {
          this.log(`Error while running: ${cmdstr}`, { stderr });
          reject(err);
        }

        try {
          const result = JSON.parse(stdout);
          resolve(result);
        } catch (ex) {
          this.log(`Error parsing task output: ${cmdstr} ${ex}`);
          reject(ex);
        }
      });
    });
  }

  /**
   * Run a command for side-effect where we don't care about the output, just
   * the error code.  Currently goes through a shell.
   */
  _runCommand(argStr) {
    return new Promise((resolve, reject) => {
      const cmdStr = 'task ' + argStr;
      exec(cmdStr, (err, stdout, stderr) => {
        if (err) {
          console.error('Error while running:', cmdstr);
          console.error(stderr);
          reject(err);
        }

        resolve(undefined);
      });
    });
  }

  /**
   * Asynchronously gets the list of all known unfinished tasks.  (That's what
   * pending means.)
   */
  async getRecentPending(force) {
    // If there's a pending request, wait for it.
    if (this._activePendingRequest) {
      await this._activePendingRequest;
    }

    // We want new data if we don't have any recent data and it's over 1 second
    // old.  (Or we're forcing it.)
    if (force || !this._recentPending ||
        ((Date.now() - this._lastExported) > 1000)) {
      this._activePendingRequest = this._runExport('export status:pending');
      this._recentPending = await this._activePendingRequest;
      //this.log('updated task list', this._recentPending);
      // If any other calls to getRecentPending() blocked above, we'll still be
      // the first one woken up, so us clearing the value next will work as we
      // desire.
      this._activePendingRequest = null;
      // Track validity starting after we got the response back, not from when
      // we issued the request.
      this._lastExported = Date.now();

      // Keep `this.activeTask` up-to-date.  (There's no upside to letting it
      // get out of date.)
      this._computeActiveTask();
    } else {
      //this.log(`tasks from ${(this._lastExported - Date.now())/1000} still good enough`);
    }

    return this._recentPending;
  }

  /**
   * Get the list of all known unfinished tasks and organizes them into named
   * pages.  This is the original, naive implementation.
   */
  async getNaivePagedRecentPending() {
    const tasks = await this.getRecentPending();

    const pages = [];
    let curPage = null;

    function makeNewPage() {
      let pageNum = pages.length + 1;
      const pageName = `${pageNum}`;
      curPage = {
        name: pageName,
        tasks: []
      };
      pages.push(curPage);
    }

    for (const task of tasks) {
      if (!curPage) {
        makeNewPage();
      }
      curPage.tasks.push(task);
    }

    return pages;
  }

  /**
   * Get the list of all known unfinished tasks and organizes them into named
   * pages.  This is a slightly fancier approach that groups tasks by the first
   * segment of their hierarchical project id.
   */
  async getProjectPagedRecentPending() {
    const tasks = await this.getRecentPending();

    const pageMap = new Map();
    const allPages = [];
    let curPage = null;

    function placeTaskInPage(task, pageName) {
      let page = pageMap.get(pageName);
      if (!page) {
        page = {
          name: pageName,
          tasks: []
        };
        pageMap.set(pageName, page);
        allPages.push(page);
      }
      page.tasks.push(task);
    }

    function mergePages(pages) {
      let tasks = [];
      for (let page of pages) {
        tasks = tasks.concat(page.tasks);
      }

      return {
        name: '(catch-all)',
        tasks
      };
    }

    for (const task of tasks) {
      const project = (task.project && task.project.split('.')[0]) || '(none)';
      placeTaskInPage(task, project);
    }

    // ## Merge pages that have too few tasks into a super-page.
    if (allPages.length > 8) {
      // sort pages by task count.
      allPages.sort((a, b) => b.length - a.length);
      allPages.push(mergePages(allPages.splice(7)));
    }

    // ## Sort pages alphabetically.
    allPages.sort((a, b) => a.name.localeCompare(b.name));

    return allPages;
  }

  /**
   * Find the most recent `start` date or null if there is no active task,
   * assigning it to `this.activeTask`.  Used to keep the active task
   * up-to-date.
   */
  _computeActiveTask() {
    let mostRecentStartedTask = null;
    for (const task of this._recentPending) {
      if (task.start) {
        if (!mostRecentStartedTask ||
            (parseTaskDate(task.start) > parseTaskDate(mostRecentStartedTask.start))) {
          mostRecentStartedTask = task;
        }
      }
    }
    this.activeTask = mostRecentStartedTask;
  }

  /**
   * Return the task with the most recent `start` date or null if there is no
   * active task.
   */
  async getActiveTask() {
    // This updates this.activeTask for side-effect for now.
    const tasks = await this.getRecentPending();
    return this.activeTask;
  }

  async getPendingTasks() {
    const tasks = await this.getRecentPending();
    return tasks;
  }

  /**
   * Mark the given task as active after first marking the prior active task as
   * not active.  There's probably a more clever taskwarrior flow that can leave
   * things started, but I'm not there yet.
   *
   * Automatically refreshes the set of pending tasks before returning.
   */
  async setActiveTask(task) {
    if (!task) {
      throw new Error('Pass a task!');
    }

    // Note that we don't force an update here; we're assuming that we are the
    // only entity messing with taskwarrior, at least in the last second.
    const activeTask = await this.getActiveTask();
    if (activeTask) {
      await this._runCommand(`uuid:${activeTask.uuid} stop`);
    }

    await this._runCommand(`uuid:${task.uuid} start`);

    // Force an update of our task status.
    await this.getRecentPending(true);
  }

  /**
   * Mark the given task as done and refreshes the pending task list.  Does not
   * set a new active task.  If you don't provide a task, we assume you want the
   * currently active task marked done.
   */
  async markTaskDone(task) {
    if (!task) {
      task = await this.getActiveTask();
      if (!task) {
        return;
      }
    }

    await this._runCommand(`uuid:${task.uuid} done`);

    // Force an update of our task status.
    await this.getRecentPending(true);
  }
}

module.exports.TaskManager = TaskManager;
