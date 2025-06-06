// Background script for Serene Focus Pomodoro Timer
// console.log('[BACKGROUND] Background script initialized'); // Temporarily commented out for debugging line 1 error

// Default settings
const DEFAULT_SETTINGS = {
    workDuration: 25 * 60,      // 25 minutes in seconds
    shortBreakDuration: 5 * 60,  // 5 minutes
    longBreakDuration: 15 * 60   // 15 minutes
};

// Initialize extension
chrome.runtime.onInstalled.addListener(async (details) => {
    console.log(`[BACKGROUND] Extension installed/updated: ${details.reason || 'unknown reason'}`);
    // Set default settings if not already set
    console.log('[BACKGROUND] Checking for existing settings');
    const data = await chrome.storage.local.get('settings');
    if (!data.settings) {
        console.log('[BACKGROUND] No settings found, applying defaults');
        await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
    } else {
        console.log('[BACKGROUND] Using existing settings:', data.settings);
    }
    
    // Set up the badge
    updateBadge();
    
    // Request notification permission
    if (Notification.permission !== 'granted') {
        Notification.requestPermission();
    }
});

// Listen for tab updates to enforce break mode
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    // Only process loading events with a URL
    if (changeInfo.status !== 'loading' || !tab.url) {
        console.log('[BACKGROUND] Ignoring non-loading tab update or missing URL');
        return;
    }

    // Skip chrome:// and extension URLs
    if (tab.url.startsWith('chrome://') || 
        tab.url.startsWith('edge://') || 
        tab.url.startsWith('chrome-extension://') ||
        tab.url.startsWith('about:')) {
        console.log('[BACKGROUND] Ignoring browser/extension URL:', tab.url);
        return;
    }

    console.log('[BACKGROUND] Tab updated:', { 
        tabId, 
        url: tab.url,
        status: changeInfo.status
    });
    
    // Get the current timer state
    const data = await chrome.storage.local.get(['timerState']);
    const timerState = data.timerState || {};
    
    console.log('[BACKGROUND] Current timer state:', timerState);

    // Only enforce break mode if we're actually in a break
    const isBreakPage = tab.url.includes('break.html');
    const shouldEnforceBreak = timerState.mode === 'break' && timerState.isRunning;
    
    if (!shouldEnforceBreak) {
        console.log('[BACKGROUND] Not in an active break, skipping break enforcement');
        return;
    }

    // If we get here, we're in a break and need to enforce it
    const breakUrl = chrome.runtime.getURL('break.html');
    
    // Don't redirect if already on the break page
    if (isBreakPage || tab.url === breakUrl) {
        console.log('[BACKGROUND] Already on break page, no redirection needed');
        return;
    }
    
    console.log(`[BACKGROUND] Break mode active - redirecting to break page`);
    try {
        await chrome.tabs.update(tabId, { url: breakUrl });
        console.log('[BACKGROUND] Successfully redirected to break page');
    } catch (error) {
        console.error('[BACKGROUND] Failed to redirect to break page:', error);
    }
});

// Listen for messages from popup and break page
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // Helper to handle async message processing
    const handleAsync = async () => {
        try {
            console.log(`[BACKGROUND] Received message: ${request.type}`, request);
            
            switch (request.type) {
                case 'UPDATE_BADGE':
                    await updateBadge();
                    return { success: true };
                    
                case 'SHOW_NOTIFICATION':
                    if (!request.title) {
                        throw new Error('Notification title is required');
                    }
                    await showNotification(request.title, request.options || {});
                    return { success: true };
                    
                case 'START_TIMER':
                    await startTimerAlarm();
                    return { success: true };
                    
                case 'PAUSE_TIMER':
                    await chrome.alarms.clear('pomodoroTimer');
                    return { success: true };
                    
                case 'RESET_TIMER':
                    await chrome.alarms.clear('pomodoroTimer');
                    await updateBadge();
                    return { success: true };
                    
                case 'LOG_MESSAGE': {
                    const { level = 'log', senderComponent = 'unknown', args = [] } = request.payload || {};
                    const logPrefix = `[${senderComponent.toUpperCase()}]`;
                    const logger = console[level] || console.log;
                    logger(logPrefix, ...args);
                    return { success: true };
                }
                    
                default:
                    console.warn('[BACKGROUND] Unknown message type:', request.type);
                    return { success: false, error: 'Unknown message type' };
            }
        } catch (error) {
            console.error('[BACKGROUND] Error processing message:', error);
            return { 
                success: false, 
                error: error.message || 'Unknown error occurred',
                stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
            };
        }
    };

    // Handle the async response if sendResponse is provided
    if (sendResponse) {
        handleAsync()
            .then(sendResponse)
            .catch(error => {
                console.error('[BACKGROUND] Error in message handler:', error);
                sendResponse({ 
                    success: false, 
                    error: 'Internal server error',
                    details: process.env.NODE_ENV === 'development' ? error.message : undefined
                });
            });
        return true; // Keep the message channel open for async response
    } else {
        // Fire and forget if no response is expected
        handleAsync().catch(console.error);
    }
});

// Handle BREAK_ENDED message separately since it's more complex
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'BREAK_ENDED') {
        console.log('[BACKGROUND] BREAK_ENDED message received, manualResume:', request.manualResume);
        
        // Handle break ended - update timer state
        (async () => {
            try {
                // Get the current timer state
                console.log('[BACKGROUND] Fetching current timer state');
                const data = await chrome.storage.local.get(['timerState', 'settings']);
                console.log('[BACKGROUND] Current timer state:', data.timerState);
                
                // If no timer state exists, create a new one
                if (!data.timerState) {
                    console.log('[BACKGROUND] No active timer state found, creating new one');
                    data.timerState = {
                        mode: 'work',
                        isRunning: false,
                        timeLeft: data.settings?.workDuration || (25 * 60),
                        sessionsCompleted: 0
                    };
                } else {
                    // Update existing timer state for work mode
                    const workDuration = data.settings?.workDuration || (25 * 60);
                    const now = Date.now();
                    
                    data.timerState.mode = 'work';
                    data.timerState.isRunning = request.manualResume; // Start running if manual resume
                    data.timerState.timeLeft = workDuration;
                    
                    // If manually resuming, set the timer end time
                    if (request.manualResume) {
                        data.timerState.timerEndTime = now + (workDuration * 1000);
                        console.log('[BACKGROUND] Setting timer end time for work session:', new Date(data.timerState.timerEndTime).toISOString());
                    } else {
                        delete data.timerState.timerEndTime;
                    }
                }
                
                // Save the new state
                console.log('[BACKGROUND] Saving updated timer state to storage');
                await chrome.storage.local.set({ 
                    timerState: data.timerState,
                    // Clear any stored URLs to prevent conflicts
                    originalTabUrls: null,
                    lastActiveUrl: null
                });
                console.log('[BACKGROUND] Timer state saved successfully');
                
                // If this was a manual resume, start the work timer
                if (request.manualResume) {
                    console.log('[BACKGROUND] Manual resume detected, starting work timer');
                    
                    // Clear all existing pomodoro alarms first
                    await Promise.all([
                        chrome.alarms.clear('pomodoroTimer'),
                        chrome.alarms.clear('pomodoroTimerRecurring')
                    ]);
                    console.log('[BACKGROUND] Cleared all existing pomodoro alarms');
                    
                    // Set the timer to running state with precise timing
                    const now = Date.now();
                    const workDurationMs = data.timerState.timeLeft * 1000;
                    data.timerState.isRunning = true;
                    data.timerState.timerEndTime = now + workDurationMs;
                    
                    console.log(`[BACKGROUND] Setting work timer: ${data.timerState.timeLeft}s remaining, ` +
                                `ending at ${new Date(data.timerState.timerEndTime).toISOString()}`);
                    
                    // Save the updated state
                    await chrome.storage.local.set({ timerState: data.timerState });
                    console.log('[BACKGROUND] Updated timer state saved to storage');
                    
                    // Create immediate alarm for first tick, then regular intervals
                    await chrome.alarms.create('pomodoroTimer', {
                        when: now + 1000  // First check in 1 second for immediate response
                    });
                    
                    // Set up the repeating alarm after first tick
                    await chrome.alarms.create('pomodoroTimerRecurring', {
                        periodInMinutes: 0.5,  // Subsequent checks every 30 seconds
                        when: now + 30000  // Start recurring checks after 30 seconds
                    });
                    
                    console.log('[BACKGROUND] Timer alarms created - immediate check in 1s, then every 30s');
                    
                    // Update the badge immediately
                    await updateBadge();
                    console.log('[BACKGROUND] Badge updated with new timer state');
                    
                    // Notify any open popup about the state change
                    try {
                        await chrome.runtime.sendMessage({ 
                            type: 'TIMER_STATE_UPDATE',
                            state: data.timerState 
                        });
                        console.log('[BACKGROUND] Notified popup about timer state update');
                    } catch (error) {
                        // This is expected if popup is closed
                        console.log('[BACKGROUND] Could not notify popup (might be closed)');
                    }
                }
                
                // Update the badge to reflect the new state
                await updateBadge();
                
                // Notify the popup that the break has ended
                try {
                    console.log('[BACKGROUND] Notifying popup that break has ended');
                    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
                    if (tabs && tabs.length > 0) {
                        await chrome.tabs.sendMessage(tabs[0].id, { 
                            type: 'TIMER_STATE_UPDATE',
                            state: data.timerState 
                        });
                        console.log('[BACKGROUND] Sent TIMER_STATE_UPDATE to popup');
                    }
                } catch (error) {
                    console.error('[BACKGROUND] Failed to notify popup:', error);
                }
                
                // Send response if needed
                if (sendResponse) {
                    sendResponse({ success: true });
                }
            } catch (error) {
                console.error('[BACKGROUND] Error handling break end:', error);
                if (sendResponse) {
                    sendResponse({ 
                        success: false, 
                        error: error.message 
                    });
                }
            }
        })();
        
        // Return true to indicate we will send a response asynchronously
        return true;
    }
    
    // Return true to indicate we will send a response asynchronously
    return true;
});

// Update the extension badge with time remaining
async function updateBadge() {
    console.log('[BACKGROUND] Updating badge');
    const data = await chrome.storage.local.get('timerState');
    console.log('[BACKGROUND] Current timer state for badge update:', data.timerState);
    
    if (!data.timerState || !data.timerState.isRunning) {
        console.log('[BACKGROUND] No active timer or timer not running, clearing badge');
        // Clear badge when timer is not running
        chrome.action.setBadgeText({ text: '' });
    } else {
        // Calculate minutes remaining
        const minutes = Math.ceil(data.timerState.timeLeft / 60);
        const text = minutes > 0 ? minutes.toString() : '';
        console.log(`[BACKGROUND] Setting badge text: ${text}`);
        
        // Only show minutes, not seconds
        chrome.action.setBadgeText({ text: minutes.toString() });
        
        // Set badge color based on mode
        const color = data.timerState.mode === 'work' ? '#4a89dc' : '#a0d468';
        console.log(`[BACKGROUND] Setting badge color: ${color}`);
        chrome.action.setBadgeBackgroundColor({ color });
    }
}

// Show notification
function showNotification(title, options = {}) {
    // Request permission if not granted
    if (Notification.permission !== 'granted') {
        Notification.requestPermission().then(permission => {
            if (permission === 'granted') {
                createNotification(title, options);
            }
        });
    } else {
        createNotification(title, options);
    }
}

// Helper to create notification
function createNotification(title, options) {
    // Add icon if not provided
    if (!options.icon) {
        options.icon = 'icons/icon128.png';
    }
    
    // Create and show notification
    chrome.notifications.create('', {
        type: 'basic',
        iconUrl: chrome.runtime.getURL(options.icon),
        title: title,
        message: options.body || '',
        priority: 2
    });
}

// Helper function to start the timer alarm
function startTimerAlarm() {
    // Clear any existing timer
    chrome.alarms.clear('pomodoroTimer');
    // Create new alarm that triggers every 30 seconds (minimum allowed)
    chrome.alarms.create('pomodoroTimer', {
        periodInMinutes: 0.5, // 30 seconds (minimum allowed)
        when: Date.now() + 30000 // Start in 30 seconds
    });
}

// Keep track of active timers
// Handle timer completion and break page redirection
chrome.alarms.onAlarm.addListener(async (alarm) => {
    console.log(`[BACKGROUND] Alarm triggered: ${alarm.name}`);
    if (alarm.name === 'pomodoroTimer') {
        console.log('[BACKGROUND] Processing pomodoro timer alarm');
        const data = await chrome.storage.local.get(['timerState']);
        if (data.timerState?.isRunning) {
            const now = Date.now();
            // Calculate remaining time
            const remaining = Math.ceil((data.timerState.timerEndTime - now) / 1000);
            
            if (remaining <= 0) {
                // Timer completed
                console.log('[BACKGROUND] Timer completed, handling completion');
                const isWorkMode = data.timerState.mode === 'work';
                
                // If it was work mode, switch to break mode
                if (isWorkMode) {
                    console.log('[BACKGROUND] Work session completed. Transitioning to break.');
                    const settingsData = await chrome.storage.local.get(['settings', 'sessionsCompleted']);
                    const settings = settingsData.settings || DEFAULT_SETTINGS;
                    let sessionsCompleted = settingsData.sessionsCompleted || 0;
                    
                    sessionsCompleted++;
                    
                    const isLongBreak = sessionsCompleted > 0 && sessionsCompleted % 4 === 0;
                    const breakDuration = isLongBreak ? settings.longBreakDuration : settings.shortBreakDuration;
                    
                    const newTimerState = {
                        mode: 'break',
                        isRunning: true,
                        timeLeft: breakDuration,
                        timerEndTime: Date.now() + (breakDuration * 1000),
                        sessionsCompleted: sessionsCompleted
                    };
                    
                    await chrome.storage.local.set({ 
                        timerState: newTimerState,
                        sessionsCompleted: sessionsCompleted // Also save sessionsCompleted separately for consistency
                    });
                    console.log('[BACKGROUND] New break state saved:', newTimerState);

                    const breakUrl = chrome.runtime.getURL('break.html');
                    // Store original tab URLs for redirection
                    const windows = await chrome.windows.getAll({ populate: true });
                    const tabsToUpdate = [];
                    for (const window of windows) {
                        for (const tab of window.tabs) {
                            if (tab.url && !tab.url.includes('break.html') && !tab.url.startsWith('chrome://') && !tab.url.startsWith('edge://')) {
                                tabsToUpdate.push({ tabId: tab.id, url: tab.url });
                            }
                        }
                    }
                    if (tabsToUpdate.length > 0) {
                        await chrome.storage.local.set({ originalTabUrls: JSON.stringify(tabsToUpdate) });
                        for (const tab of tabsToUpdate) {
                            try {
                                await chrome.tabs.update(tab.tabId, { url: breakUrl });
                            } catch (error) {
                                console.warn(`[BACKGROUND] Failed to update tab ${tab.tabId} to break page:`, error);
                            }
                        }
                    }

                    console.log('[BACKGROUND] Showing work complete notification for break start.');
                    try {
                        await showNotification(
                            'Work Session Complete!',
                            { body: `Time for a ${isLongBreak ? 'long' : 'short'} break!`, icon: 'icons/icon48.png' }
                        );
                        console.log('[BACKGROUND] Work complete notification shown.');
                    } catch (error) {
                        console.error('[BACKGROUND] Failed to show work complete notification:', error);
                    }

                    // Notify popup of the new state
                    console.log('[BACKGROUND] Sending TIMER_STATE_UPDATE to popup for break start.');
                    chrome.runtime.sendMessage({ type: 'TIMER_STATE_UPDATE', state: newTimerState }).catch(e => console.warn('[BACKGROUND] Failed to send TIMER_STATE_UPDATE to popup (popup might be closed):', e));
                    await updateBadge(); // Update badge for the new break state

                } else { // Break session completed
                    console.log('[BACKGROUND] Break session completed. Transitioning to work.');
                    const settingsData = await chrome.storage.local.get('settings');
                    const settings = settingsData.settings || DEFAULT_SETTINGS;

                    const newTimerState = {
                        mode: 'work',
                        isRunning: false, // Work sessions do not auto-start from background
                        timeLeft: settings.workDuration,
                        timerEndTime: 0, // Will be set when user starts it or popup loads
                        sessionsCompleted: data.timerState.sessionsCompleted // Keep same session count until next work completion
                    };

                    await chrome.storage.local.set({ timerState: newTimerState });
                    console.log('[BACKGROUND] New work state saved after break:', newTimerState);

                    // Notify popup of the new state
                    console.log('[BACKGROUND] Sending TIMER_STATE_UPDATE to popup for work start (manual).');
                    chrome.runtime.sendMessage({ type: 'TIMER_STATE_UPDATE', state: newTimerState }).catch(e => console.warn('[BACKGROUND] Failed to send TIMER_STATE_UPDATE to popup (popup might be closed):', e));
                    await updateBadge(); // Update badge (should show 'Work' or be clear)
                }
                // No longer clearing badge here, updateBadge() handles it based on state.
            } else {
                // Update badge with remaining minutes
                const minutes = Math.ceil(remaining / 60);
                chrome.action.setBadgeText({ text: minutes.toString() });
                
                // Set badge color based on mode
                const color = data.timerState.mode === 'work' ? '#4a89dc' : '#a0d468';
                chrome.action.setBadgeBackgroundColor({ color });
            }
        }
    }
});

// Initialize
chrome.runtime.onStartup.addListener(async () => {
    // Restore any running timers
    const data = await chrome.storage.local.get(['timerState']);
    if (data.timerState?.isRunning) {
        // If timer was running, restart the background timer
        startTimerAlarm();
        // Update badge
        await updateBadge();
    } else {
        // Make sure badge is cleared if no timer is running
        await updateBadge();
    }
});

// Set up context menu
chrome.runtime.onInstalled.addListener(() => {
    try {
        // Create a context menu item
        chrome.contextMenus.create({
            id: 'sereneFocusMenu',
            title: 'Start Serene Focus',
            contexts: ['action']
        }, () => {
            if (chrome.runtime.lastError) {
                console.warn('Context menu creation warning:', chrome.runtime.lastError);
                return;
            }
            
            // Add submenu items
            chrome.contextMenus.create({
                id: 'startFocus',
                parentId: 'sereneFocusMenu',
                title: 'Start Focus Session',
                contexts: ['action']
            });
            
            chrome.contextMenus.create({
                id: 'takeBreak',
                parentId: 'sereneFocusMenu',
                title: 'Take a Break',
                contexts: ['action']
            });
            
            chrome.contextMenus.create({
                id: 'resetTimer',
                parentId: 'sereneFocusMenu',
                title: 'Reset Timer',
                contexts: ['action']
            });
        });
    } catch (error) {
        console.error('Error creating context menu:', error);
    }
});

// Handle context menu clicks
function handleContextMenuClick(info, tab) {
    try {
        if (!info || !info.menuItemId) {
            console.warn('No menu item ID in context menu click');
            return;
        }

        const messageType = {
            'startFocus': 'START_FOCUS',
            'takeBreak': 'START_BREAK',
            'resetTimer': 'RESET_TIMER'
        }[info.menuItemId];

        if (!messageType) {
            console.warn('Unknown menu item clicked:', info.menuItemId);
            return;
        }

        // Send message to popup
        chrome.runtime.sendMessage({ type: messageType }, (response) => {
            if (chrome.runtime.lastError) {
                console.warn('Error sending message:', chrome.runtime.lastError);
            }
        });
    } catch (error) {
        console.error('Error in context menu click handler:', error);
    }
}

// Add the click listener with error handling
try {
    chrome.contextMenus.onClicked.addListener(handleContextMenuClick);
} catch (error) {
    console.error('Failed to add context menu click listener:', error);
}

// Listen for tab activation to check if we need to redirect to break page
chrome.tabs.onActivated.addListener(async (activeInfo) => {
    const data = await chrome.storage.local.get(['timerState']);
    
    if (data.timerState?.mode === 'break' && data.timerState?.isRunning) {
        const tab = await chrome.tabs.get(activeInfo.tabId);
        const breakUrl = chrome.runtime.getURL('break.html');
        
        // Don't redirect if already on the break page or a new tab page
        if (tab.url !== breakUrl && !tab.url.includes('break.html') && 
            !tab.url.startsWith('chrome://') && !tab.url.startsWith('edge://')) {
            // Get the current timer state
            const now = Date.now();
            
            // Only redirect if the break is still active
            if (data.timerState.timerEndTime && now < data.timerState.timerEndTime) {
                const remainingTime = Math.ceil((data.timerState.timerEndTime - now) / 1000);
                
                // Store the current URL to return to after break
                await chrome.storage.local.set({ 
                    lastActiveUrl: tab.url,
                    timerState: {
                        ...data.timerState,
                        timeLeft: remainingTime
                    }
                });
                
                // Show notification
                console.log('[BACKGROUND] Showing work complete notification');
                try {
                    await showNotification(
                        'Work Session Complete!',
                        { body: 'Time for a break!', icon: 'icons/icon48.png' }
                    );
                    console.log('[BACKGROUND] Work complete notification shown');
                } catch (error) {
                    console.error('[BACKGROUND] Failed to show work complete notification:', error);
                }
                
                // Redirect to break page
                await chrome.tabs.update(activeInfo.tabId, { url: breakUrl });
            }
        }
    }
});
