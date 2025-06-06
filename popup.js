// ===== CENTRALIZED LOGGER =====
function sendToBackgroundLog(level, ...args) {
    // Fallback to local console if sending fails for some reason
    try {
        chrome.runtime.sendMessage({
            type: 'LOG_MESSAGE',
            payload: {
                level: level, // 'log', 'warn', 'error'
                senderComponent: 'popup',
                args: args
            }
        }).catch(e => originalConsole[level]('[POPUP_FALLBACK]', ...args)); // Log locally if send fails
    } catch (e) {
        originalConsole[level]('[POPUP_FALLBACK]', ...args); // Log locally if sendMessage not available (e.g., during very early init)
    }
}

// Store original console functions before overriding
const originalConsole = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console)
};

console.log = (...args) => sendToBackgroundLog('log', ...args);
console.warn = (...args) => sendToBackgroundLog('warn', ...args);
console.error = (...args) => sendToBackgroundLog('error', ...args);
// ===== END CENTRALIZED LOGGER =====

/* ===== POMODORO TIMER POPUP SCRIPT =====
 * 
 * ASCII Flowchart:
 * 
 * ╔════════════════╗     ┌─────────────────────────────────────────────┐
 * │  popup.html    │     │                  init()                    │
 * │  Loaded        ├────>│  • Loads settings                         │
 * ╚════════════════╝     │  • Restores timer state                   │
 *                        │  • Sets up UI elements                    │
 *                        └───────────────┬───────────────────────────┘
 *                                         │
 *                                         │ 1. Initializes event listeners
 *                                         ▼
 *                        ┌────────────────┼─────────────────┐
 *                        │    setupEventListeners()         │
 *                        └────────┬────────┬────────┬───────┘
 *                                 │        │        │
 *                      ┌──────────┘        │        └───────────────┐
 *                      │                   │                        │
 *                      ▼                   ▼                        ▼
 *             ┌────────────────┐  ┌───────────────┐  ┌────────────────────┐
 *             │  Start/Pause   │  │    Reset      │  │     Settings       │
 *             │  Button Click  │  │    Button     │  │     Button Click   │
 *             └────────┬───────┘  └───────┬───────┘  └─────────┬──────────┘
 *                      │                  │                     │
 *                      ▼                  ▼                     ▼
 *             ┌─────────────────┐ ┌───────────────┐  ┌───────────────────┐
 *             │  toggleTimer()  │ │  resetTimer() │  │   openSettings()  │
 *             └────────┬────────┘ └───────────────┘  └─────────┬─────────┘
 *                      │                                        │
 *                      │ 2. If starting                       │
 *                      ▼                                        │
 *             ┌─────────────────┐                              │
 *             │   startTimer()  │◄─────────────────────────────┘
 *             │  • Sets end time│
 *             │  • Saves state  │
 *             └────────┬────────┘
 *                      │
 *                      │ 3. Updates every 100ms
 *                      ▼
 *             ┌─────────────────┐     +---------------------+
 *             │   updateTimer() │◄────┤  setInterval loop   │
 *             └────────┬────────┘     +---------------------+
 *                      │
 *                      │ 4. When time runs out
 *                      ▼
 *             ┌─────────────────┐     +---------------------+
 *             │ handleTimer-    │     │  Timer Complete!    │
 *             │ Complete()      │◄────┤  • Plays sound      │
 *             └────────┬────────┘     │  • Shows alert     │
 *                      │              +---------------------+
 *                      │
 *                      │ 5. If work completed
 *                      ▼
 *             ┌─────────────────┐
 *             │   startBreak()  │
 *             │  • Saves tabs   │
 *             │  • Opens break  │
 *             │    page         │
 *             └─────────────────┘
 * 
 * State Transitions:
 * 1. STOPPED → RUNNING: User clicks "Start"
 * 2. RUNNING → PAUSED: User clicks "Pause"
 * 3. PAUSED → RUNNING: User clicks "Resume"
 * 4. RUNNING → COMPLETE: Timer reaches zero
 * 5. COMPLETE → (Next State): Auto-starts break/work
 */

/* ===== POMODORO TIMER POPUP SCRIPT =====
This script manages the main timer interface that appears when you click the extension icon.
It handles the Pomodoro work/break cycle, timer controls, and user settings.
*/

// Get references to all the HTML elements we'll be interacting with
const timerDisplay = document.getElementById('timer');          // The main timer display (MM:SS)
const statusDisplay = document.getElementById('status');        // Shows "Working" or "Break"
const startPauseBtn = document.getElementById('startPauseBtn'); // Start/Pause button
const resetBtn = document.getElementById('resetBtn');           // Reset button
const progressBar = document.getElementById('progress');        // Visual progress bar
const sessionCountDisplay = document.getElementById('sessionCount'); // Shows completed sessions
const settingsBtn = document.getElementById('settingsBtn');      // Settings button
const settingsModal = document.getElementById('settingsModal'); // Settings popup
const closeSettingsBtn = document.getElementById('closeSettings'); // Close settings button
const saveSettingsBtn = document.getElementById('saveSettings');  // Save settings button

// Timer duration input fields
const workDurationInput = document.getElementById('workDuration');
const shortBreakInput = document.getElementById('shortBreakDuration');
const longBreakInput = document.getElementById('longBreakDuration');

// Audio elements for sound notifications
const timerEndSound = document.getElementById('timerEndSound');   // Sound when work timer ends
const breakEndSound = document.getElementById('breakEndSound');   // Sound when break ends

/* ===== STATE VARIABLES =====
These variables keep track of the timer's current state.
*/
let timer;                  // Reference to the interval timer
let timeLeft = 0;           // Remaining time in seconds
let isRunning = false;      // Whether the timer is currently running
let currentMode = 'work';   // Current mode: 'work' or 'break'
let sessionsCompleted = 0;  // Number of completed work sessions
let timerEndTime = 0;       // Timestamp when the current timer will end
let lastUpdateTime = 0;     // When we last updated the display
let lastSyncTime = 0;       // When we last synced with background

// Constants for timer synchronization
const SYNC_INTERVAL = 1000;    // How often to update the UI (milliseconds)
const ALARM_INTERVAL = 30000;  // How often to sync with background (30 seconds)

// Default timer settings (in seconds)
let settings = {
    workDuration: 25 * 60,       // 25 minutes work
    shortBreakDuration: 5 * 60,   // 5 minutes short break
    longBreakDuration: 15 * 60    // 15 minutes long break
};

/**
 * Initializes the popup when it's opened.
 * Loads settings, restores timer state, and sets up the UI.
 */
async function init() {
    // Clear any existing alarms to prevent duplicate timers
    await chrome.alarms.clear('pomodoroTimer');
    
    // Load all necessary data from Chrome's local storage
    const data = await chrome.storage.local.get([
        'settings',         // User's timer duration settings
        'timerState',       // Current state of the timer
        'sessionsCompleted' // Number of completed work sessions
    ]);

    // Restore saved settings if they exist
    if (data.settings) {
        settings = data.settings;
        updateSettingsInputs(); // Update the settings form inputs
    }

    // Restore completed sessions count
    if (data.sessionsCompleted !== undefined) {
        sessionsCompleted = data.sessionsCompleted;
        updateSessionCount(); // Update the session counter display
    }

    // Check if we have a saved timer state to restore
    if (data.timerState) {
        const now = Date.now();
        const state = data.timerState;
        
        // Restore a running timer if it hasn't expired yet
        if (state.isRunning && state.timerEndTime > now) {
            // Calculate remaining time from the stored end time
            timeLeft = Math.ceil((state.timerEndTime - now) / 1000);
            currentMode = state.mode;
            isRunning = true;
            timerEndTime = state.timerEndTime;
            startTimer(); // Resume the running timer
        } 
        // Restore a paused work timer
        else if (state.mode === 'work' && !state.isRunning) {
            timeLeft = state.timeLeft || settings.workDuration;
            currentMode = 'work';
            isRunning = false;
        } 
        // Restore a paused break timer
        else if (state.mode === 'break' && !state.isRunning) {
            // Determine if it was a long or short break
            const isLongBreak = sessionsCompleted > 0 && sessionsCompleted % 4 === 0;
            timeLeft = state.timeLeft || (isLongBreak ? settings.longBreakDuration : settings.shortBreakDuration);
            currentMode = 'break';
            isRunning = false;
        } else {
            // Default to a new work session if no valid state
            timeLeft = settings.workDuration;
        }
    } else {
        // No saved state, start fresh with a work timer
        timeLeft = settings.workDuration;
    }

    // Update the UI to reflect the current state
    updateDisplay();
    
    // Set up all event listeners for user interactions
    setupEventListeners();
}

/**
 * Sets up all event listeners for user interactions.
 * This function is called during initialization.
 */
function setupEventListeners() {
    // Timer control buttons
    startPauseBtn.addEventListener('click', toggleTimer);  // Start/Pause the timer
    resetBtn.addEventListener('click', resetTimer);        // Reset the current timer
    
    // Settings modal controls
    settingsBtn.addEventListener('click', openSettings);      // Open settings
    closeSettingsBtn.addEventListener('click', closeSettings); // Close settings
    saveSettingsBtn.addEventListener('click', saveSettings);  // Save settings
    
    // Listen for break end messages from break page
    chrome.runtime.onMessage.addListener((message) => {
        if (message.type === 'BREAK_ENDED') {
            console.log('Break ended, switching to work mode');
            handleBreakEnd(message.manualResume || false);
        }
        return true;
    });
    
    // Close settings when clicking outside the modal
    window.addEventListener('click', (e) => {
        if (e.target === settingsModal) {
            closeSettings();
        }
    });
    
    // Listen for keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // Space or Enter to toggle timer
        if ((e.code === 'Space' || e.code === 'Enter') && e.target.tagName !== 'INPUT') {
            e.preventDefault();
            toggleTimer();
        }
        // Escape to close settings if open
        if (e.code === 'Escape' && settingsModal.style.display === 'block') {
            closeSettings();
        }
    });

    // Listen for messages from other parts of the extension (e.g., break.js, background.js)
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        console.log('[POPUP] Received message:', { type: message?.type, sender: sender?.tab?.url || 'background', message });
        
        // Handle timer state updates from background
        if (message.type === 'TIMER_STATE_UPDATE') {
            console.log('[POPUP] Processing TIMER_STATE_UPDATE:', message.state);
            
            if (message.state) {
                // Update local state
                const previousMode = currentMode;
                const wasRunning = isRunning;
                
                currentMode = message.state.mode || 'work';
                isRunning = message.state.isRunning || false;
                timeLeft = message.state.timeLeft || timeLeft;
                sessionsCompleted = message.state.sessionsCompleted || sessionsCompleted;
                
                console.log(`[POPUP] State updated - Mode: ${currentMode}, Running: ${isRunning}, Time Left: ${timeLeft}s`);
                
                // Update UI
                updateDisplay();
                
                // If mode changed to work and timer should be running, start it
                if (currentMode === 'work' && isRunning && !wasRunning) {
                    console.log('[POPUP] Starting work timer from state update');
                    startTimer();
                }
                
                // If mode changed, update the UI
                if (previousMode !== currentMode) {
                    updateModeDisplay();
                }
            }
            
            if (sendResponse) {
                sendResponse({ success: true });
            }
            return true;
        }
        
        // Handle break ended message
        if (message.type === 'BREAK_ENDED') {
            console.log('[POPUP] Processing BREAK_ENDED, calling handleBreakEnd with manualResume:', message.manualResume);
            
            // Ensure the popup is in the correct state
            if (currentMode !== 'work') {
                console.log('[POPUP] Switching to work mode before handling break end');
                switchToWorkMode();
            }
            
            // Handle the break end
            handleBreakEnd(message.manualResume);
            
            // Save the updated state
            saveTimerState();
            
            // Always respond to the message
            if (sendResponse) {
                sendResponse({ success: true });
            }
            
            // Return true to indicate we'll respond asynchronously
            return true;
        }
        
        // For other message types, we don't need to respond asynchronously
        return false;
    });
}

/**
 * Toggles the timer between running and paused states.
 * This is the main function called when the Start/Pause button is clicked.
 */
function toggleTimer() {
    if (isRunning) {
        pauseTimer();  // Pause if currently running
    } else {
        startTimer(); // Start if currently paused
    }
}

/**
 * Starts or resumes the timer countdown.
 * Sets up the timer end time, updates the UI, and creates background alarms.
 */
function startTimer() {
    console.log('[START_TIMER] Called, current state:', { 
        currentMode, 
        isRunning, 
        timeLeft,
        sessionsCompleted
    });
    
    // Don't start if there's no time left
    if (timeLeft <= 0) {
        console.log('[START_TIMER] Not starting - no time left');
        return;
    }
    
    // Update UI to show timer is running
    isRunning = true;
    startPauseBtn.textContent = 'Pause';
    startPauseBtn.classList.add('paused');
    
    // Calculate the exact timestamp when the timer should end
    const now = Date.now();
    timerEndTime = now + (timeLeft * 1000);
    lastUpdateTime = now;
    lastSyncTime = now;
    
    // Save the current state to persistent storage
    console.log('[POPUP] Saving timer state before starting:', { currentMode, isRunning, timeLeft, timerEndTime });
    saveTimerState();
    console.log('[POPUP] Requesting background to start timer alarm');
    // Request background.js to start the timer alarm instead of creating it here
    // This avoids conflicts with background.js alarm management
    chrome.runtime.sendMessage({ type: 'START_TIMER' }).catch(e => console.error('[POPUP] Failed to request START_TIMER to background:', e));
    
    // Start the UI update loop (runs every 100ms for smooth display)
    timer = setInterval(updateTimer, 100);
}

/**
 * Updates the timer display and checks if the timer has completed.
 * This function runs repeatedly while the timer is active.
 */
function updateTimer() {
    const now = Date.now();
    // Calculate remaining time in seconds, rounding up
    const remaining = Math.ceil((timerEndTime - now) / 1000);
    // Ensure timeLeft is never negative
    timeLeft = Math.max(0, remaining);
    
    // Update the UI with the current time
    updateDisplay();
    
    // Periodically save state to handle browser restarts
    // Save at least every 5 seconds or on significant time changes
    if (now - lastUpdateTime >= 5000 || remaining % 30 === 0) {
        saveTimerState();
        lastUpdateTime = now;
    }
    
    // Sync with background script at a lower frequency
    if (now - lastSyncTime >= ALARM_INTERVAL) {
        saveTimerState();
        lastSyncTime = now;
    }
    
    // Check if timer has reached zero
    if (timeLeft <= 0) {
        clearInterval(timer);  // Stop the update loop
        handleTimerComplete(); // Handle completion (start break or work session)
    }
}

/**
 * Pauses the running timer.
 * Stops the countdown and updates the UI to show the timer is paused.
 */
function pauseTimer() {
    isRunning = false;  // Update state
    clearInterval(timer);  // Stop the update loop
    
    // Update UI to show paused state
    startPauseBtn.textContent = 'Resume';
    startPauseBtn.classList.remove('paused');
    
    // Request background.js to clear any existing alarms
    console.log('[POPUP] Requesting background to clear timer alarm');
    chrome.runtime.sendMessage({ type: 'PAUSE_TIMER' }).catch(e => console.error('[POPUP] Failed to request PAUSE_TIMER to background:', e));
    
    // Save the current state so we can resume later
    saveTimerState();
}

/**
 * Resets the timer to its initial state for the current mode.
 * Clears any running timers and updates the UI accordingly.
 */
function resetTimer() {
    // Stop any running timer interval
    clearInterval(timer);
    isRunning = false;
    
    // Reset time left based on current mode and session count
    timeLeft = currentMode === 'work' 
        ? settings.workDuration 
        : (sessionsCompleted % 4 === 0 ? settings.longBreakDuration : settings.shortBreakDuration);
    
    // Update UI to show reset state
    updateDisplay();
    startPauseBtn.textContent = 'Start';
    
    // Save the reset state instead of removing it
    console.log('[POPUP] Saving reset timer state:', { currentMode, isRunning, timeLeft });
    saveTimerState();
    
    // Request background.js to update badge (which will clear it since isRunning is false)
    console.log('[POPUP] Requesting background to update badge after reset');
    chrome.runtime.sendMessage({ type: 'UPDATE_BADGE' }).catch(e => console.error('[POPUP] Failed to request UPDATE_BADGE to background:', e));
}

/**
 * Handles timer completion based on the current mode (work or break).
 * Plays appropriate sounds, shows notifications, and manages the work/break cycle.
 */
function handleTimerComplete() {
    if (currentMode === 'work') {
        // Work session completed
        sessionsCompleted++;  // Increment completed sessions counter
        updateSessionCount(); // Update the UI to show new count
        
        // Play work completion sound if available
        if (timerEndSound) {
            timerEndSound.play().catch(e => console.error('Error playing sound:', e));
        }
        
        // Show a desktop notification
        showNotification('Time for a break!', {
            body: `You've completed ${sessionsCompleted} ${sessionsCompleted === 1 ? 'session' : 'sessions'}.`,
            icon: 'icon-48.png'  // Path to your extension icon
        });
        
        // Transition to break mode
        startBreak();
    } else {
        // Break completed
        if (breakEndSound) {
            breakEndSound.play().catch(e => console.error('Error playing sound:', e));
        }
        
        // Show notification that break is over
        showNotification('Break Time Over!', {
            body: 'Time to get back to work!',
            icon: 'icon-48.png'
        });
        
        // Switch back to work mode
        switchToWorkMode();
    }
}

/**
 * Initiates a break period, saving the current tab state and opening the break page.
 * Handles both short and long breaks based on session count.
 */
async function startBreak() {
    // Determine break type: long break every 4 sessions, otherwise short break
    const isLongBreak = sessionsCompleted > 0 && sessionsCompleted % 4 === 0;
    const breakDuration = isLongBreak ? settings.longBreakDuration : settings.shortBreakDuration;
    
    console.log(`Starting ${isLongBreak ? 'long' : 'short'} break for ${breakDuration} seconds`);
    
    try {
        // Get all currently open tabs
        const tabs = await chrome.tabs.query({});
        const tabsToRedirect = [];
        
        // Process each tab to save its URL for later restoration
        for (const tab of tabs) {
            const url = tab.url || tab.pendingUrl;
            if (url && 
                !url.startsWith('chrome://') && 
                !url.startsWith('edge://') && 
                !url.includes('break.html') &&
                !url.startsWith(chrome.runtime.getURL(''))) {
                
                tabsToRedirect.push({
                    tabId: tab.id,
                    url: url
                });
            }
        }
        
        console.log(`Saving ${tabsToRedirect.length} tabs for break`);
        
        // Update timer state for break
        currentMode = 'break';
        timeLeft = breakDuration;
        isRunning = true;
        const now = Date.now();
        timerEndTime = now + (breakDuration * 1000);
        lastUpdateTime = now;
        
        // Save the current state including original tab URLs
        await chrome.storage.local.set({
            timerState: {
                mode: 'break',
                timeLeft: breakDuration,
                isRunning: true,
                timestamp: now,
                timerEndTime: timerEndTime,
                sessionsCompleted: sessionsCompleted
            },
            originalTabUrls: JSON.stringify(tabsToRedirect),
            lastActiveUrl: null
        });
        
        // Open the break page in a new tab
        const breakUrl = chrome.runtime.getURL('break.html');
        console.log('Opening break page:', breakUrl);
        await chrome.tabs.create({ url: breakUrl, active: true });
        
        // Close the popup
        window.close();
        
    } catch (error) {
        console.error('Error starting break:', error);
        // Fallback to simple timer if something goes wrong
        currentMode = 'break';
        timeLeft = breakDuration;
        isRunning = true;
        timerEndTime = Date.now() + (breakDuration * 1000);
        updateDisplay();
        startTimer();
    }
}

/**
 * Handles the end of a break period when triggered from the break page.
 * @param {boolean} manualResume - Whether the break was ended manually by the user
 */
function handleBreakEnd(manualResume = false) {
    console.log(`[HANDLE_BREAK_END] Called with manualResume: ${manualResume}`);
    
    return new Promise(async (resolve, reject) => {
        try {
            console.log('[HANDLE_BREAK_END] Current state before switch:', { 
                currentMode, 
                isRunning, 
                timeLeft, 
                sessionsCompleted 
            });
            
            // Switch to work mode first
            console.log('[HANDLE_BREAK_END] Switching to work mode');
            await switchToWorkMode();
            
            console.log('[HANDLE_BREAK_END] State after switchToWorkMode:', { 
                currentMode, 
                isRunning, 
                timeLeft, 
                sessionsCompleted 
            });
            
            // If this was a manual resume, start the work timer
            if (manualResume) {
                console.log('[HANDLE_BREAK_END] Manual resume detected, starting work timer');
                
                // Ensure we're in work mode
                if (currentMode !== 'work') {
                    console.log('[HANDLE_BREAK_END] Forcing work mode before starting timer');
                    currentMode = 'work';
                }
                
                // Reset the timer to full work duration
                const settings = await chrome.storage.local.get('settings');
                timeLeft = settings.settings?.workDuration || (25 * 60);
                
                // Start the timer
                startTimer();
                
                console.log('[HANDLE_BREAK_END] Work timer started successfully');
            } else {
                console.log('[HANDLE_BREAK_END] Automatic break end, not starting timer');
            }
            
            // Save the updated state
            await saveTimerState();
            
            // Update the display
            updateDisplay();
            
            resolve(true);
        } catch (error) {
            console.error('[HANDLE_BREAK_END] Error:', error);
            reject(error);
        }
    });
}

/**
 * Switches from break mode back to work mode.
 * Updates the UI and resets the timer state.
 */
function switchToWorkMode() {
    console.log('[SWITCH_TO_WORK_MODE] Called, current state:', { 
        currentMode, 
        isRunning, 
        timeLeft 
    });
    
    // Update timer state for work mode
    currentMode = 'work';
    timeLeft = settings.workDuration;
    isRunning = false;
    
    // Update the UI to reflect work mode
    updateDisplay();
    startPauseBtn.textContent = 'Start';
    
    // Save the new state
    saveTimerState();
}

// Display Functions
/**
 * Updates all UI elements to reflect the current timer state.
 * This includes the timer display, status text, progress bar, and browser badge.
 */
function updateDisplay() {
    // Format time as MM:SS with leading zeros
    const minutes = Math.floor(timeLeft / 60);
    const seconds = timeLeft % 60;
    timerDisplay.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    
    // Update status text and apply appropriate CSS class
    const statusText = currentMode === 'work' ? 'Working' : 'Break';
    statusDisplay.textContent = statusText;
    statusDisplay.className = currentMode;  // Applies color coding via CSS
    
    // Update the visual progress indicator
    updateProgressBar();
    
    // Update the browser extension badge with time remaining
    updateBadge();
    
    // Update the document title to show time and status (visible in browser tab)
    document.title = `(${minutes}:${seconds.toString().padStart(2, '0')}) ${statusText} - Pomodoro Timer`;
}

/**
 * Updates the visual progress bar based on the current timer state.
 * The progress bar shows the completion percentage of the current work/break session.
 */
function updateProgressBar() {
    // Determine the total duration based on current mode and session count
    const totalTime = currentMode === 'work' 
        ? settings.workDuration 
        : (sessionsCompleted % 4 === 0 ? settings.longBreakDuration : settings.shortBreakDuration);
    
    // Calculate completion percentage (0-100)
    const progress = Math.min(100, Math.max(0, ((totalTime - timeLeft) / totalTime) * 100));
    
    // Update the width of the progress bar
    progressBar.style.width = `${progress}%`;
    
    // Update progress bar color based on mode
    progressBar.style.backgroundColor = currentMode === 'work' ? '#4a89dc' : '#a0d468';
}

/**
 * Updates the session counter display and saves it to storage.
 * Shows the number of completed work sessions in the current set (out of 4).
 */
function updateSessionCount() {
    // Update the display with the current session count
    sessionCountDisplay.textContent = `Sessions: ${sessionsCompleted}/4`;
    
    // Save the updated count to persistent storage
    chrome.storage.local.set({ sessionsCompleted })
        .catch(error => console.error('Error saving session count:', error));
    
    // Update the badge to show session progress
    updateBadge();
}

/**
 * Updates the browser action badge with the current timer state.
 * Shows the number of minutes remaining during work/break.
 */
function updateBadge() {
    if (!isRunning) {
        // Clear badge when timer is stopped
        chrome.action.setBadgeText({ text: '' });
        return;
    }
    
    // Calculate minutes remaining (rounded up)
    const minutes = Math.ceil(timeLeft / 60);
    
    // Only show badge if we have a valid time
    if (minutes > 0) {
        const badgeText = minutes > 60 
            ? '60+'  // Show 60+ for very long timers
            : minutes.toString();
            
        // Set badge text and color based on current mode
        chrome.action.setBadgeText({ text: badgeText });
        chrome.action.setBadgeBackgroundColor({
            color: currentMode === 'work' ? '#4a89dc' : '#a0d468'
        });
    } else {
        chrome.action.setBadgeText({ text: '' });
    }
}

// Settings Functions

/**
 * Opens the settings modal and populates the input fields with current values.
 */
function openSettings() {
    settingsModal.style.display = 'flex';
    updateSettingsInputs();
    
    // Focus the first input field for better UX
    workDurationInput.focus();
}

/**
 * Closes the settings modal without saving changes.
 */
function closeSettings() {
    settingsModal.style.display = 'none';
    
    // Restore original values in case of cancel
    updateSettingsInputs();
}

/**
 * Updates the settings input fields with current timer durations.
 * Converts seconds to minutes for display.
 */
function updateSettingsInputs() {
    workDurationInput.value = Math.floor(settings.workDuration / 60);
    shortBreakInput.value = Math.floor(settings.shortBreakDuration / 60);
    longBreakInput.value = Math.floor(settings.longBreakDuration / 60);
    
    // Validate and correct any invalid values
    validateSettingsInputs();
}

/**
 * Validates all settings inputs to ensure they contain valid numbers.
 * Sets minimum values if needed.
 */
function validateSettingsInputs() {
    // Minimum duration in minutes
    const minMinutes = 1;
    
    // Ensure all inputs are valid numbers and at least minimum duration
    if (isNaN(workDurationInput.value) || workDurationInput.value < minMinutes) {
        workDurationInput.value = minMinutes;
    }
    if (isNaN(shortBreakInput.value) || shortBreakInput.value < minMinutes) {
        shortBreakInput.value = minMinutes;
    }
    if (isNaN(longBreakInput.value) || longBreakInput.value < minMinutes) {
        longBreakInput.value = minMinutes;
    }
    
    // Ensure long break is not shorter than short break
    if (parseInt(longBreakInput.value) < parseInt(shortBreakInput.value)) {
        longBreakInput.value = shortBreakInput.value;
    }
}

/**
 * Saves the current settings from the form inputs to storage.
 * Validates inputs and updates the timer if needed.
 */
async function saveSettings() {
    // Validate all inputs first
    validateSettingsInputs();
    
    // Convert minutes to seconds for storage
    const newSettings = {
        workDuration: parseInt(workDurationInput.value) * 60,
        shortBreakDuration: parseInt(shortBreakInput.value) * 60,
        longBreakDuration: parseInt(longBreakInput.value) * 60
    };
    
    // Double-check minimum durations (should be handled by validate, but just in case)
    const minDuration = 60; // 1 minute in seconds
    if (newSettings.workDuration < minDuration || 
        newSettings.shortBreakDuration < minDuration || 
        newSettings.longBreakDuration < minDuration) {
        alert('Minimum duration is 1 minute');
        return;
    }
    
    try {
        // Update in-memory settings
        settings = newSettings;
        
        // Save to persistent storage
        await chrome.storage.local.set({ settings });
        
        // If timer is not running, update the display with new durations
        if (!isRunning) {
            timeLeft = currentMode === 'work' 
                ? settings.workDuration 
                : (sessionsCompleted % 4 === 0 ? settings.longBreakDuration : settings.shortBreakDuration);
            updateDisplay();
        } else {
            // If timer is running, just update the end time to reflect new duration
            if (currentMode === 'work') {
                const timeElapsed = settings.workDuration - timeLeft;
                timeLeft = settings.workDuration - timeElapsed;
            }
            saveTimerState();
        }
        
        // Close the settings modal
        closeSettings();
        
    } catch (error) {
        console.error('Failed to save settings:', error);
        alert('Failed to save settings. Please try again.');
    }
}

// Helper Functions

/**
 * Saves the current timer state to Chrome's local storage.
 * This allows the timer to persist across browser sessions and popup closes.
 */
function saveTimerState() {
    const now = Date.now();
    
    // Calculate remaining time, accounting for whether the timer is running
    const remainingTime = isRunning 
        ? Math.max(0, Math.ceil((timerEndTime - now) / 1000))
        : timeLeft;
    
    // Prepare the state object
    const timerState = {
        mode: currentMode,
        timeLeft: remainingTime,
        isRunning,
        timestamp: now,
        timerEndTime: isRunning ? timerEndTime : 0,
        sessionsCompleted
    };
    
    // Save to storage with error handling
    chrome.storage.local.set({ timerState })
        .catch(error => console.error('Failed to save timer state:', error));
}

/**
 * Displays a desktop notification to the user.
 * Handles permission requests and falls back to console logging if needed.
 * 
 * @param {string} title - The title of the notification
 * @param {Object} [options={}] - Notification options (body, icon, etc.)
 */
function showNotification(title, options = {}) {
    // Default notification options
    const defaultOptions = {
        icon: 'icon-48.png',
        requireInteraction: true,
        silent: false
    };
    
    // Merge default options with provided options
    const notificationOptions = { ...defaultOptions, ...options };
    
    // Check if notifications are supported
    if (!('Notification' in window)) {
        console.warn('This browser does not support desktop notifications');
        return;
    }
    
    // Check if permission is already granted
    if (Notification.permission === 'granted') {
        // Create and show the notification
        new Notification(title, notificationOptions);
    } 
    // Otherwise, request permission
    else if (Notification.permission !== 'denied') {
        Notification.requestPermission().then(permission => {
            if (permission === 'granted') {
                new Notification(title, notificationOptions);
            } else {
                console.log('Notification permission denied');
            }
        }).catch(error => {
            console.error('Error requesting notification permission:', error);
        });
    }
    
    // If permission was previously denied, we can't show notifications
    // Log to console as a fallback
    if (Notification.permission === 'denied') {
        console.log(`[Notification] ${title}`, options.body || '');
    }
}

// Initialize the app
init();
