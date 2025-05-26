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
            // Store the current URL to return to after break
            await chrome.storage.local.set({ lastActiveUrl: tab.url });
            
            // Redirect to break page
            await chrome.tabs.update(tabId, { url: breakUrl });
        }
    }
});

// Listen for messages from popup and break page
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'UPDATE_BADGE') {
        updateBadge();
    } else if (message.type === 'SHOW_NOTIFICATION') {
        showNotification(message.title, message.options);
    }
    
    // Return true to indicate we'll respond asynchronously
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

// Keep track of active timers
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'pomodoroTimer') {
        // Handle timer completion in the popup
        chrome.runtime.sendMessage({ type: 'TIMER_COMPLETE' });
    }
});

// Initialize
chrome.runtime.onStartup.addListener(() => {
    // Restore any running timers
    chrome.storage.local.get(['timerState'], (data) => {
        if (data.timerState?.isRunning) {
            // Update badge when extension starts
            updateBadge();
        }
    });
});

// Set up context menu
chrome.runtime.onInstalled.addListener(() => {
    // Create a context menu item
    chrome.contextMenus.create({
        id: 'sereneFocusMenu',
        title: 'Start Serene Focus',
        contexts: ['action']
    });
    
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

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
    switch (info.menuItemId) {
        case 'startFocus':
            // Send message to popup to start focus session
            chrome.runtime.sendMessage({ type: 'START_FOCUS' });
            break;
        case 'takeBreak':
            // Send message to popup to start break
            chrome.runtime.sendMessage({ type: 'START_BREAK' });
            break;
        case 'resetTimer':
            // Send message to popup to reset timer
            chrome.runtime.sendMessage({ type: 'RESET_TIMER' });
            break;
    }
});

// Listen for tab activation to check if we need to redirect to break page
chrome.tabs.onActivated.addListener(async (activeInfo) => {
    const data = await chrome.storage.local.get(['timerState']);
    
    if (data.timerState?.mode === 'break' && data.timerState?.isRunning) {
        const tab = await chrome.tabs.get(activeInfo.tabId);
        const breakUrl = chrome.runtime.getURL('break.html');
        
        // Don't redirect if already on the break page or a new tab page
        if (tab.url !== breakUrl && !tab.url.includes('break.html') && 
            !tab.url.startsWith('chrome://') && !tab.url.startsWith('edge://')) {
            // Store the current URL to return to after break
            await chrome.storage.local.set({ lastActiveUrl: tab.url });
            
            // Redirect to break page
            await chrome.tabs.update(activeInfo.tabId, { url: breakUrl });
        }
    }
});
