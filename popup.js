// DOM Elements
const timerDisplay = document.getElementById('timer');
const statusDisplay = document.getElementById('status');
const startPauseBtn = document.getElementById('startPauseBtn');
const resetBtn = document.getElementById('resetBtn');
const progressBar = document.getElementById('progress');
const sessionCountDisplay = document.getElementById('sessionCount');
const settingsBtn = document.getElementById('settingsBtn');
const settingsModal = document.getElementById('settingsModal');
const closeSettingsBtn = document.getElementById('closeSettings');
const saveSettingsBtn = document.getElementById('saveSettings');
const workDurationInput = document.getElementById('workDuration');
const shortBreakInput = document.getElementById('shortBreakDuration');
const longBreakInput = document.getElementById('longBreakDuration');
const timerEndSound = document.getElementById('timerEndSound');
const breakEndSound = document.getElementById('breakEndSound');

// State
let timer;
let timeLeft = 0;
let isRunning = false;
let currentMode = 'work'; // 'work' or 'break'
let sessionsCompleted = 0;
let timerEndTime = 0;
let lastUpdateTime = 0;
let settings = {
    workDuration: 25 * 60, // in seconds
    shortBreakDuration: 5 * 60,
    longBreakDuration: 15 * 60
};

// Initialize the popup
async function init() {
    // Load settings from storage
    const data = await chrome.storage.local.get([
        'settings', 
        'timerState', 
        'sessionsCompleted'
    ]);

    if (data.settings) {
        settings = data.settings;
        updateSettingsInputs();
    }

    if (data.sessionsCompleted) {
        sessionsCompleted = data.sessionsCompleted;
        updateSessionCount();
    }

    // Restore timer state if exists
    if (data.timerState) {
        const { mode, timeLeft: savedTime, isRunning: wasRunning, timerEndTime: savedEndTime } = data.timerState;
        currentMode = mode;
        isRunning = wasRunning;
        
        if (isRunning && savedEndTime) {
            timerEndTime = savedEndTime;
            const now = Date.now();
            if (now >= timerEndTime) {
                handleTimerComplete();
            } else {
                timeLeft = Math.ceil((timerEndTime - now) / 1000);
                startTimer();
            }
        } else {
            timeLeft = savedTime;
            updateDisplay();
        }
    } else {
        timeLeft = settings.workDuration;
        updateDisplay();
    }

    setupEventListeners();
}

// Event Listeners
function setupEventListeners() {
    startPauseBtn.addEventListener('click', toggleTimer);
    resetBtn.addEventListener('click', resetTimer);
    settingsBtn.addEventListener('click', openSettings);
    closeSettingsBtn.addEventListener('click', closeSettings);
    saveSettingsBtn.addEventListener('click', saveSettings);

    // Listen for break end from break page
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === 'BREAK_ENDED') {
            handleBreakEnd();
        }
    });
}

// Timer Functions
function toggleTimer() {
    if (isRunning) {
        pauseTimer();
    } else {
        startTimer();
    }
}

function startTimer() {
    if (timeLeft <= 0) return;
    
    isRunning = true;
    startPauseBtn.textContent = 'Pause';
    startPauseBtn.classList.add('paused');
    
    // Calculate when the timer should end
    timerEndTime = Date.now() + (timeLeft * 1000);
    lastUpdateTime = Date.now();
    
    saveTimerState();
    timer = setInterval(updateTimer, 100);
}

function updateTimer() {
    const now = Date.now();
    const remaining = Math.ceil((timerEndTime - now) / 1000);
    timeLeft = Math.max(0, remaining);
    
    updateDisplay();
    
    // Save progress every 5 seconds
    if (now - lastUpdateTime >= 5000) {
        saveTimerState();
        lastUpdateTime = now;
    }
    
    if (timeLeft <= 0) {
        clearInterval(timer);
        handleTimerComplete();
    }
}

function pauseTimer() {
    isRunning = false;
    clearInterval(timer);
    startPauseBtn.textContent = 'Resume';
    startPauseBtn.classList.remove('paused');
    saveTimerState();
}

function resetTimer() {
    clearInterval(timer);
    isRunning = false;
    
    // Reset to current mode's duration
    timeLeft = currentMode === 'work' ? settings.workDuration : 
              (sessionsCompleted % 4 === 0 ? settings.longBreakDuration : settings.shortBreakDuration);
    
    updateDisplay();
    startPauseBtn.textContent = 'Start';
    
    // Clear saved state
    chrome.storage.local.remove(['timerState']);
    
    // Update progress bar
    updateProgressBar();
}

function handleTimerComplete() {
    if (currentMode === 'work') {
        // Work session completed, start break
        sessionsCompleted++;
        updateSessionCount();
        
        // Play sound
        if (timerEndSound) {
            timerEndSound.play().catch(e => console.error('Error playing sound:', e));
        }
        
        // Show notification
        showNotification('Time for a break!', {
            body: `You've completed ${sessionsCompleted} ${sessionsCompleted === 1 ? 'session' : 'sessions'}.`
        });
        
        // Start break
        startBreak();
    } else {
        // Break completed, notify break page
        if (breakEndSound) {
            breakEndSound.play().catch(e => console.error('Error playing sound:', e));
        }
        
        // Switch back to work mode
        switchToWorkMode();
    }
}

function startBreak() {
    // Determine break duration (long break every 4 sessions)
    const isLongBreak = sessionsCompleted % 4 === 0;
    const breakDuration = isLongBreak ? settings.longBreakDuration : settings.shortBreakDuration;
    
    // Update state
    currentMode = 'break';
    timeLeft = breakDuration;
    isRunning = true;
    timerEndTime = Date.now() + (breakDuration * 1000);
    lastUpdateTime = Date.now();
    
    // Save state with force flag to ensure new break starts fresh
    chrome.storage.local.set({
        timerState: {
            mode: 'break',
            timeLeft: breakDuration,
            isRunning: true,
            timestamp: Date.now(),
            timerEndTime: timerEndTime,
            sessionsCompleted: sessionsCompleted
        },
        // Clear any existing break state
        lastActiveUrl: null
    }, () => {
        // Open break page in new tab
        const breakUrl = chrome.runtime.getURL('break.html');
        chrome.tabs.create({ url: breakUrl });
        
        // Close popup
        window.close();
    });
}

function handleBreakEnd() {
    // This is called when the user clicks the resume button on the break page
    switchToWorkMode();
}

function switchToWorkMode() {
    currentMode = 'work';
    timeLeft = settings.workDuration;
    isRunning = false;
    
    // Update UI
    updateDisplay();
    startPauseBtn.textContent = 'Start';
    
    // Save state
    saveTimerState();
    
    // Redirect back to last active URL
    chrome.storage.local.get(['lastActiveUrl'], (data) => {
        const lastUrl = data.lastActiveUrl || 'chrome://newtab/';
        chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
            if (tabs[0] && tabs[0].url.includes('break.html')) {
                chrome.tabs.update(tabs[0].id, { url: lastUrl });
            }
        });
    });
}

// Display Functions
function updateDisplay() {
    const minutes = Math.floor(timeLeft / 60);
    const seconds = timeLeft % 60;
    timerDisplay.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    
    // Update status text
    if (currentMode === 'work') {
        statusDisplay.textContent = isRunning ? 'Stay focused!' : 'Ready to focus?';
        document.body.classList.toggle('focus-mode', isRunning);
    } else {
        statusDisplay.textContent = isRunning ? 'Take a break!' : 'Break time!';
    }
    
    // Update progress bar
    updateProgressBar();
}

function updateProgressBar() {
    const totalTime = currentMode === 'work' ? settings.workDuration : 
                    (sessionsCompleted % 4 === 0 ? settings.longBreakDuration : settings.shortBreakDuration);
    const progress = ((totalTime - timeLeft) / totalTime) * 100;
    progressBar.style.width = `${progress}%`;
}

function updateSessionCount() {
    sessionCountDisplay.textContent = `Sessions: ${sessionsCompleted}/4`;
    chrome.storage.local.set({ sessionsCompleted });
}

// Settings Functions
function openSettings() {
    settingsModal.style.display = 'flex';
    updateSettingsInputs();
}

function closeSettings() {
    settingsModal.style.display = 'none';
}

function updateSettingsInputs() {
    workDurationInput.value = settings.workDuration / 60;
    shortBreakInput.value = settings.shortBreakDuration / 60;
    longBreakInput.value = settings.longBreakDuration / 60;
}

async function saveSettings() {
    const newSettings = {
        workDuration: parseInt(workDurationInput.value) * 60,
        shortBreakDuration: parseInt(shortBreakInput.value) * 60,
        longBreakDuration: parseInt(longBreakInput.value) * 60
    };
    
    // Validate inputs
    if (newSettings.workDuration < 60 || newSettings.shortBreakDuration < 60 || newSettings.longBreakDuration < 60) {
        alert('Minimum duration is 1 minute');
        return;
    }
    
    // Update settings
    settings = newSettings;
    await chrome.storage.local.set({ settings });
    
    // Reset timer with new settings if not running
    if (!isRunning) {
        timeLeft = currentMode === 'work' ? settings.workDuration : 
                 (sessionsCompleted % 4 === 0 ? settings.longBreakDuration : settings.shortBreakDuration);
        updateDisplay();
    }
    
    closeSettings();
}

// Helper Functions
function saveTimerState() {
    const now = Date.now();
    const remainingTime = isRunning ? Math.ceil((timerEndTime - now) / 1000) : timeLeft;
    
    chrome.storage.local.set({
        timerState: {
            mode: currentMode,
            timeLeft: remainingTime,
            isRunning,
            timestamp: now,
            timerEndTime: isRunning ? timerEndTime : 0,
            sessionsCompleted
        }
    });
}

function showNotification(title, options = {}) {
    // Request permission if not granted
    if (Notification.permission !== 'granted') {
        Notification.requestPermission().then(permission => {
            if (permission === 'granted') {
                new Notification(title, options);
            }
        });
    } else {
        new Notification(title, options);
    }
}

// Initialize the app
init();
