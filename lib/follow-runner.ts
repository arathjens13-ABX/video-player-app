/**
 * When followed shows get checked: at launch, when the app comes back to the
 * front, every 30 minutes while it's open, and in the background whenever iOS
 * grants a slot (often only a few times a day). Background checks only read
 * show pages and queue new episodes; videos are found and downloaded once the
 * app is open, by the season-download queue.
 */
import * as BackgroundTask from 'expo-background-task';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { AppState } from 'react-native';

import { describeNew } from './follow-logic';
import { checkFollows, listFollows } from './follows';
import { logInfo, logWarn } from './log';

const TASK = 'vidstash-follow-check';
const FOREGROUND_EVERY_MS = 30 * 60_000;
/** iOS treats this as "no more often than"; it usually runs much less often. */
const BACKGROUND_MINUTES = 60;

// Must be defined when the JS bundle loads, so a background launch finds it.
TaskManager.defineTask(TASK, async () => {
  try {
    const results = await checkFollows();
    await announce(results, 'background');
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch (e) {
    logWarn('follow', 'background check failed:', e);
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});

async function announce(results: Awaited<ReturnType<typeof checkFollows>>, when: string) {
  const text = describeNew(results);
  if (!text) return;
  logInfo('follow', `${when} check: ${text.title} — ${text.body}`);
  try {
    await Notifications.scheduleNotificationAsync({ content: { ...text, data: { open: 'library' } }, trigger: null });
  } catch (e) {
    logWarn('follow', 'notification failed:', e);
  }
}

let running = false;

/** Checks now (skipping shows checked in the last 25 minutes unless `force`). */
export async function checkFollowsNow(force = false) {
  if (running) return;
  running = true;
  try {
    await announce(await checkFollows({ force }), force ? 'manual' : 'foreground');
  } finally {
    running = false;
  }
}

/** Asks once for permission to show notifications (when the first show is followed). */
export async function askForNotifications() {
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted || !current.canAskAgain) return current.granted;
    return (await Notifications.requestPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

/** Keeps the background check registered while there's something to follow. */
export async function syncBackgroundCheck() {
  try {
    const registered = await TaskManager.isTaskRegisteredAsync(TASK);
    const wanted = listFollows().length > 0;
    if (wanted && !registered) await BackgroundTask.registerTaskAsync(TASK, { minimumInterval: BACKGROUND_MINUTES });
    else if (!wanted && registered) await BackgroundTask.unregisterTaskAsync(TASK);
  } catch (e) {
    logWarn('follow', 'background check registration failed:', e);
  }
}

let started = false;

/** Starts the foreground schedule (call once at launch). */
export function initFollowChecks() {
  if (started) return;
  started = true;
  syncBackgroundCheck();
  checkFollowsNow().catch(() => {});
  setInterval(() => {
    if (AppState.currentState === 'active') checkFollowsNow().catch(() => {});
  }, FOREGROUND_EVERY_MS);
  AppState.addEventListener('change', (state) => {
    if (state === 'active') checkFollowsNow().catch(() => {});
  });
}
