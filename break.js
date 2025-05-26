// DOM Elements
const timerDisplay = document.getElementById('timer');
const resumeBtn = document.getElementById('resumeBtn');
const breakMessage = document.getElementById('breakMessage');
const tipElement = document.getElementById('tip');

// State
let timeLeft = 0;
let isBreakActive = true;
let timer;
let timerEndTime = 0;
let lastUpdateTime = 0;

// Break tips
const breakTips = [
    "Look away from the screen and focus on something 20 feet away for 20 seconds",
    "Stand up and stretch your arms, neck, and shoulders",
    "Take a few deep breaths to relax your mind",
    "Close your eyes and relax your facial muscles",
    "Do some gentle neck and shoulder rolls"
];

// Timer Functions
function saveBreakState() {
    const now = Date.now();
    const remainingTime = isBreakActive ? Math.ceil((timerEndTime - now) / 1000) : timeLeft;
    
    chrome.storage.local.set({
        timerState: {
            mode: 'break',
            timeLeft: remainingTime,
            isRunning: isBreakActive,
            timestamp: now,
            timerEndTime: isBreakActive ? timerEndTime : 0
        }
    });
}

function startBreakTimer() {
    if (timer) clearInterval(timer);
    
    isBreakActive = true;
    timerEndTime = Date.now() + (timeLeft * 1000);
    lastUpdateTime = Date.now();
    
    saveBreakState();
    timer = setInterval(updateBreakTimer, 100);
}

function updateBreakTimer() {
    const now = Date.now();
    const remaining = Math.ceil((timerEndTime - now) / 1000);
    timeLeft = Math.max(0, remaining);
    
    updateDisplay();
    
    if (now >= timerEndTime) {
        clearInterval(timer);
        breakComplete();
    } else if (now - lastUpdateTime >= 5000) {
        saveBreakState();
        lastUpdateTime = now;
    }
}

function breakComplete() {
    clearInterval(timer);
    isBreakActive = false;
    resumeBtn.disabled = false;
    resumeBtn.textContent = 'Resume Working';
    updateDisplay();
    
    // Send message to popup that break has ended
    try {
        chrome.runtime.sendMessage({ type: 'BREAK_ENDED' }, (response) => {
            if (chrome.runtime.lastError) {
                console.log('Error sending message:', chrome.runtime.lastError);
            }
        });
    } catch (error) {
        console.log('Error sending message:', error);
    }
}

function endBreak() {
    clearInterval(timer);
    isBreakActive = false;
    
    // Save the break state before ending
    saveBreakState();
    
    // Send message to popup that break was ended manually
    try {
        chrome.runtime.sendMessage({ type: 'BREAK_ENDED' }, (response) => {
            if (chrome.runtime.lastError) {
                console.log('Error sending message:', chrome.runtime.lastError);
            }
        });
    } catch (error) {
        console.log('Error sending message:', error);
    } finally {
        // Always close the break page
        window.close();
    }
}

// Initialize the break page
async function init() {
    // Show a random tip
    showRandomTip();
    
    // Load settings and timer state
    const [settingsData, timerData] = await Promise.all([
        chrome.storage.local.get('settings'),
        chrome.storage.local.get('timerState')
    ]);
    
    const settings = settingsData.settings || {
        workDuration: 25 * 60,
        shortBreakDuration: 5 * 60,
        longBreakDuration: 15 * 60
    };
    
    // Get sessions completed count
    const sessionsData = await chrome.storage.local.get('sessionsCompleted');
    const sessionsCompleted = sessionsData.sessionsCompleted || 0;
    const isLongBreak = sessionsCompleted % 4 === 0;
    
    // Check if we have a valid running break timer
    if (timerData.timerState && 
        timerData.timerState.mode === 'break' && 
        timerData.timerState.isRunning &&
        timerData.timerState.timerEndTime) {
        
        const now = Date.now();
        const timeRemaining = Math.ceil((timerData.timerState.timerEndTime - now) / 1000);
        
        if (timeRemaining > 0) {
            // Valid running break found
            timeLeft = timeRemaining;
            isBreakActive = true;
            timerEndTime = timerData.timerState.timerEndTime;
            startBreakTimer();
        } else {
            // Break has already ended
            breakComplete();
        }
    } else {
        // Start a new break with current settings
        isBreakActive = true;
        timeLeft = isLongBreak ? settings.longBreakDuration : settings.shortBreakDuration;
        timerEndTime = Date.now() + (timeLeft * 1000);
        saveBreakState();
        startBreakTimer();
    }
    
    updateDisplay();
    setupEventListeners();
    
    // Listen for settings changes
    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === 'local' && changes.settings) {
            const newSettings = changes.settings.newValue;
            if (newSettings && !isBreakActive) {
                // Only update duration if not currently in a break
                const newDuration = isLongBreak ? newSettings.longBreakDuration : newSettings.shortBreakDuration;
                if (timeLeft !== newDuration) {
                    timeLeft = newDuration;
                    updateDisplay();
                }
            }
        }
    });
    
    // Prevent right-click context menu
    document.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        return false;
    });
    
    // Prevent keyboard shortcuts that could be used to close the tab
    document.addEventListener('keydown', (e) => {
        // Allow F5, F11, F12 for development
        if ([116, 122, 123].includes(e.keyCode)) return;
        
        // Block common tab/window close shortcuts
        if (e.ctrlKey && [87, 84, 78, 84, 82].includes(e.keyCode)) {
            e.preventDefault();
            e.stopPropagation();
            return false;
        }
        
        // Block F1, F3, F5
        if ([112, 114, 116].includes(e.keyCode)) {
            e.preventDefault();
            return false;
        }
    }, true);
    
    // Block back/forward navigation
    history.pushState(null, null, document.URL);
    window.addEventListener('popstate', () => {
        history.pushState(null, null, document.URL);
    });
}

// Event Listeners
function setupEventListeners() {
    // Resume button
    resumeBtn.addEventListener('click', () => {
        if (!resumeBtn.disabled) {
            endBreak();
        }
    });
    
    // Prevent right-click context menu
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    
    // Prevent keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // Allow F5, F11, F12 for development
        if ([116, 122, 123].includes(e.keyCode)) return;
        
        // Block common tab/window close shortcuts
        if (e.ctrlKey && [87, 84, 78, 84, 82].includes(e.keyCode)) {
            e.preventDefault();
            e.stopPropagation();
            return false;
        }
        
        // Block F1, F3, F5
        if ([112, 114, 116].includes(e.keyCode)) {
            e.preventDefault();
            return false;
        }
    }, true);
}

// Function to format time in MM:SS
function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

// Update the display with current time
function updateDisplay() {
    const minutes = Math.floor(timeLeft / 60);
    const seconds = timeLeft % 60;
    timerDisplay.textContent = `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
    
    if (isBreakActive) {
        breakMessage.textContent = 'Take a Break';
        resumeBtn.disabled = true;
    } else {
        breakMessage.textContent = 'Break Complete!';
        resumeBtn.disabled = false;
    }
}

// Show a random tip
function showRandomTip() {
    const randomIndex = Math.floor(Math.random() * breakTips.length);
    tipElement.textContent = breakTips[randomIndex];
}

// Show notification
function showNotification(title, options = {}) {
    // Request permission and show notification
    if (Notification.permission === 'granted') {
        new Notification(title, options);
    } else if (Notification.permission !== 'denied') {
        Notification.requestPermission().then(permission => {
            if (permission === 'granted') {
                new Notification(title, options);
            }
        });
    }
}

// Initialize the break page
document.addEventListener('DOMContentLoaded', init);
