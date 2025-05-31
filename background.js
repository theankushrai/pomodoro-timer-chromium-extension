// Background script for Serene Focus Pomodoro Timer

// Default settings
const DEFAULT_SETTINGS = {
    workDuration: 25 * 60,      // 25 minutes in seconds
    shortBreakDuration: 5 * 60,  // 5 minutes
    longBreakDuration: 15 * 60   // 15 minutes
};

// Initialize extension
chrome.runtime.onInstalled.addListener(async () => {
    // Set default settings if not already set
    const data = await chrome.storage.local.get('settings');
    if (!data.settings) {
        await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
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
    if (changeInfo.status !== 'loading') return;
    
    // Check if we're in break mode
    const data = await chrome.storage.local.get(['timerState', 'settings']);
    
    if (data.timerState?.mode === 'break' && data.timerState?.isRunning) {
        const breakUrl = chrome.runtime.getURL('break.html');
        
        // Don't redirect if already on the break page
        if (tab.url !== breakUrl && !tab.url.includes('break.html')) {
            // Get the current timer state
            const now = Date.now();
            const remainingTime = Math.ceil((data.timerState.timerEndTime - now) / 1000);
            
            // Store the current URL to return to after break
            await chrome.storage.local.set({ 
                lastActiveUrl: tab.url,
                timerState: {
                    ...data.timerState,
                    timeLeft: remainingTime
                }
            });
            
            // Redirect to break page
            await chrome.tabs.update(tabId, { url: breakUrl });
        }
    }
});

// Listen for messages from popup and break page
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'UPDATE_BADGE') {
        updateBadge();
    } else if (request.type === 'SHOW_NOTIFICATION') {
        showNotification(request.title, request.options);
    } else if (request.type === 'START_TIMER') {
        startTimerAlarm();
    } else if (request.type === 'PAUSE_TIMER') {
        chrome.alarms.clear('pomodoroTimer');
    } else if (request.type === 'RESET_TIMER') {
        chrome.alarms.clear('pomodoroTimer');
        updateBadge();
    } else if (request.type === 'BREAK_ENDED') {
        // Handle break ended - update timer state
        (async () => {
            try {
                // Get the current timer state
                const data = await chrome.storage.local.get('timerState');
                
                // Update timer state to work mode
                if (data.timerState) {
                    data.timerState.mode = 'work';
                    data.timerState.isRunning = false;
                    data.timerState.timeLeft = 25 * 60; // Reset to default work duration
                    delete data.timerState.timerEndTime;
                    
                    await chrome.storage.local.set({ 
                        timerState: data.timerState,
                        // Clear any stored URLs to prevent conflicts
                        originalTabUrls: null,
                        lastActiveUrl: null
                    });
                }
                
                // Update the badge
                await updateBadge();
                
                // Send response if needed
                if (sendResponse) {
                    sendResponse({ success: true });
                }
            } catch (error) {
                console.error('Error handling break end:', error);
                if (sendResponse) {
                    sendResponse({ success: false, error: error.message });
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
    const data = await chrome.storage.local.get(['timerState']);
    
    if (!data.timerState || !data.timerState.isRunning) {
        // Clear badge when timer is not running
        chrome.action.setBadgeText({ text: '' });
        return;
    }
    
    const timeLeft = data.timerState.timeLeft;
    const minutes = Math.ceil(timeLeft / 60);
    
    // Only show minutes, not seconds
    chrome.action.setBadgeText({ text: minutes.toString() });
    
    // Set badge color based on mode
    const color = data.timerState.mode === 'work' ? '#4a89dc' : '#a0d468';
    chrome.action.setBadgeBackgroundColor({ color });
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
        iconUrl: options.icon,
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
    if (alarm.name === 'pomodoroTimer') {
        const data = await chrome.storage.local.get(['timerState']);
        if (data.timerState?.isRunning) {
            const now = Date.now();
            // Calculate remaining time
            const remaining = Math.ceil((data.timerState.timerEndTime - now) / 1000);
            
            if (remaining <= 0) {
                // Timer completed
                const isWorkMode = data.timerState.mode === 'work';
                
                // If it was work mode, switch to break mode
                if (isWorkMode) {
                    const breakUrl = chrome.runtime.getURL('break.html');
                    // Store the current time as break start time
                    await chrome.storage.local.set({ 
                        breakStartTime: Date.now(),
                        breakUrl: breakUrl
                    });
                    
                    // Get all windows and tabs that need to be redirected
                    const windows = await chrome.windows.getAll({ populate: true });
                    const tabsToUpdate = [];
                    
                    // Find all tabs that aren't already on the break page
                    for (const window of windows) {
                        for (const tab of window.tabs) {
                            if (!tab.url.includes('break.html') && 
                                !tab.url.startsWith('chrome://') && 
                                !tab.url.startsWith('edge://')) {
                                tabsToUpdate.push({
                                    tabId: tab.id,
                                    url: tab.url
                                });
                            }
                        }
                    }
                    
                    // Store the original URLs for all tabs that will be redirected
                    if (tabsToUpdate.length > 0) {
                        await chrome.storage.local.set({ 
                            originalTabUrls: JSON.stringify(tabsToUpdate)
                        });
                        
                        // Redirect all tabs to the break page
                        for (const tab of tabsToUpdate) {
                            try {
                                await chrome.tabs.update(tab.tabId, { url: breakUrl });
                            } catch (error) {
                                console.warn(`Failed to update tab ${tab.tabId}:`, error);
                            }
                        }
                    }
                }
                
                // Notify the popup to update its state
                chrome.runtime.sendMessage({ type: 'TIMER_COMPLETE' });
                
                // Clear the badge
                chrome.action.setBadgeText({ text: '' });
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
                
                // Redirect to break page
                await chrome.tabs.update(activeInfo.tabId, { url: breakUrl });
            }
        }
    }
});
