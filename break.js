/* ===== BREAK PAGE SCRIPT =====
 * 
 * ASCII Flowchart:
 * 
 * ╔════════════════╗     ┌─────────────────────────────────────────────┐
 * │  break.html    │     │                  init()                    │
 * │  Loaded        ├────>│  • Loads settings                         │
 * ╚════════════════╝     │  • Restores break state                   │
 *                        │  • Starts break timer                    │
 *                        └───────────────┬───────────────────────────┘
 *                                         │
 *                                         │ 1. Sets up break timer
 *                                         ▼
 *                        ┌────────────────┼─────────────────┐
 *                        │   startBreakTimer()              │
 *                        │  • Sets break duration           │
 *                        │  • Starts interval               │
 *                        └────────┬────────┬────────────────┘
 *                                 │        │
 *                                ▼        ▼
 *                      +------------------+  +---------------------+
 *                      |  updateBreakTimer() |    breakComplete()  |
 *                      |  • Updates display  |<───┐ • Shows resume  |
 *                      |  • Checks time left |    │   button       |
 *                      +------------------+  |    │                |
 *                                 │         |    │ 3. When time's up
 *                                 ▼         |    │
 *                        +----------------+ |    │
 *                        | timeLeft > 0?  |─┘    │
 *                        +--------+-------+      │
 *                                 │              │
 *                                 ▼              │
 *                        ┌────────────────┐     │
 *                        │ Continue       │     │
 *                        │ counting down  │─────┘
 *                        └────────────────┘
 * 
 * Event Flow:
 * 1. User clicks "Resume" ────────┐
 *    │                           │
 *    ▼                           │
 * 2. endBreak()                  │
 *    • Restores tabs             │
 *    • Closes break page         │
 *    • Sends message to popup    │
 *    └───────────────────────────┘
 *
 * Key Functions:
 * - init(): Entry point, sets up the break page
 * - startBreakTimer(): Starts the countdown
 * - updateBreakTimer(): Updates the display and checks time
 * - breakComplete(): Handles break completion
 * - endBreak(): Called when user ends break early
 * - saveBreakState(): Persists break state
 */


/* ===== BREAK PAGE SCRIPT =====
This script handles the break page functionality of the Pomodoro timer.
It shows a countdown timer, prevents users from working during breaks,
and manages the break session state.
*/

// Get references to important HTML elements on the page
const timerDisplay = document.getElementById('timer');  // The element showing the countdown timer
const resumeBtn = document.getElementById('resumeBtn');  // The 'Resume Working' button
const breakMessage = document.getElementById('breakMessage');  // Container for break messages
const tipElement = document.getElementById('tip');  // Where we'll show helpful break tips

/* ===== STATE VARIABLES =====
These variables keep track of the current state of the break timer
*/
let timeLeft = 0;           // How many seconds are left in the current break
let isBreakActive = true;   // Whether the break timer is currently running
let timer;                  // Reference to the interval timer
let timerEndTime = 0;       // Timestamp (in milliseconds) when the break will end
let lastUpdateTime = 0;     // When we last updated the display (for performance)

/* ===== BREAK TIPS =====
These are helpful suggestions that will be shown to the user
during their break to encourage healthy habits.
*/
const breakTips = [
    "Look away from the screen and focus on something 20 feet away for 20 seconds - it's good for your eyes!",
    "Stand up and stretch your arms, neck, and shoulders to prevent stiffness",
    "Take a few deep breaths to relax your mind and reduce stress",
    "Close your eyes and relax your facial muscles - we often hold tension there",
    "Do some gentle neck and shoulder rolls to release tension"
];

/* ===== TIMER FUNCTIONS ===== */

/**
 * Saves the current break state to Chrome's storage.
 * This allows the timer to persist even if the page is closed.
 */
function saveBreakState() {
    const now = Date.now();
    // Calculate remaining time: if break is active, calculate from current time, otherwise use stored timeLeft
    const remainingTime = isBreakActive ? Math.ceil((timerEndTime - now) / 1000) : timeLeft;
    
    // Save the current state to Chrome's local storage
    chrome.storage.local.set({
        timerState: {
            mode: 'break',                    // We're in break mode
            timeLeft: remainingTime,          // How many seconds are left
            isRunning: isBreakActive,         // Whether the timer is running
            timestamp: now,                   // When we saved this state
            timerEndTime: isBreakActive ? timerEndTime : 0  // When the break will end (if active)
        }
    });
}

/**
 * Starts the break timer countdown.
 * This function sets up an interval that updates the timer display every 100ms.
 */
function startBreakTimer() {
    // Clear any existing timer to prevent multiple timers running
    if (timer) clearInterval(timer);
    
    // Set the break as active and calculate when it will end
    isBreakActive = true;
    timerEndTime = Date.now() + (timeLeft * 1000);  // Current time + break duration in milliseconds
    lastUpdateTime = Date.now();  // Track when we last updated the display
    
    // Save the current state to Chrome storage
    saveBreakState();
    
    // Start updating the timer display every 100ms for smooth counting
    timer = setInterval(updateBreakTimer, 100);
}

/**
 * Updates the break timer display and checks if the break has ended.
 * This function runs every 100ms when the timer is active.
 */
function updateBreakTimer() {
    const now = Date.now();
    // Calculate how many seconds are left (rounded up to nearest second)
    const remaining = Math.ceil((timerEndTime - now) / 1000);
    // Ensure timeLeft is never negative
    timeLeft = Math.max(0, remaining);
    
    // Update the timer display with the new time
    updateDisplay();
    
    // Check if break time is up
    if (now >= timerEndTime) {
        // Stop the timer and handle the completed break
        clearInterval(timer);
        breakComplete();
    } 
    // Save state every 5 seconds to prevent data loss
    else if (now - lastUpdateTime >= 5000) {
        saveBreakState();
        lastUpdateTime = now;
    }
}

/**
 * Handles the completion of a break.
 * This function is called when the break timer reaches zero.
 */
async function breakComplete() {
    // Stop the timer and update the UI
    // Just update the UI to show break is complete
    clearInterval(timer);
    isBreakActive = false;
    resumeBtn.disabled = false;  // Enable the resume button
    resumeBtn.textContent = 'Resume Working';
    updateDisplay();
}

/**
 * Ends the break and restores the original tab state.
 * This function is called when the user clicks 'Resume Working'.
 * Handles multiple break pages by coordinating tab restoration.
 */
async function endBreak() {
    // Stop any running timers and update the break state
    clearInterval(timer);
    isBreakActive = false;
    
    try {
        // Get saved tab data - this is the critical section
        const data = await chrome.storage.local.get(['originalTabUrls', 'lastActiveUrl']);
        
        // If no tabs to restore, just close this break page
        if (!data.originalTabUrls) {
            console.log('No tabs to restore - might be a duplicate break end');
            window.close();
            return;
        }
        
        // Parse the tab data we need to restore
        const tabsToRestore = JSON.parse(data.originalTabUrls);
        
        // Get all tabs to find break pages
        const allTabs = await chrome.tabs.query({});
        const breakTabs = allTabs.filter(tab => 
            tab.url && tab.url.includes('break.html')
        );
        
        // 1. First close other break pages
        const closePromises = breakTabs
            .filter(tab => tab.id && tab.id !== window.tabId) // Don't close self yet
            .map(tab => chrome.tabs.remove(tab.id).catch(console.error));
        
        // 2. Restore original tabs in parallel
        const restorePromises = tabsToRestore.map(tab => 
            chrome.tabs.create({ 
                url: tab.url, 
                active: false 
            }).catch(e => 
                console.warn(`Failed to restore tab ${tab.url}:`, e)
            )
        );
        
        // Wait for all tab operations to complete
        await Promise.all([...closePromises, ...restorePromises]);
        
        // 3. Only now remove the tab data, after we're done with it
        await chrome.storage.local.remove(['originalTabUrls', 'lastActiveUrl']);
        
        // 4. Notify the popup that break has ended
        await chrome.runtime.sendMessage({ 
            type: 'BREAK_ENDED',
            manualResume: true
        });
        
        // 5. Finally, close this break tab
        // The delay ensures all other operations complete first
        setTimeout(() => window.close(), 100);
    } catch (error) {
        console.error('Error during break end:', error);
        // Try to clean up and close even if there was an error
        try {
            await chrome.runtime.sendMessage({ 
                type: 'BREAK_ENDED', 
                manualResume: true 
            });
            window.close();
        } catch (e) {
            console.error('Failed to clean up after error:', e);
        }
    }
    
    // Save the current state
    saveBreakState();
}

/**
 * Initializes the break page when it loads.
 * Sets up the timer, loads settings, and restores any existing break state.
 */
// Track the current tab ID
let currentTabId;

async function init() {
    // Store the current tab ID for later use
    const tab = await chrome.tabs.getCurrent();
    if (tab && tab.id) {
        window.tabId = tab.id;
    }
    
    // Show a random helpful tip to the user
    showRandomTip();
    
    // Load both settings and timer state in parallel for better performance
    const [settingsData, timerData] = await Promise.all([
        chrome.storage.local.get('settings'),  // Get user settings
        chrome.storage.local.get('timerState') // Get current timer state
    ]);
    
    // Default settings in case none are found in storage
    const settings = settingsData.settings || {
        workDuration: 25 * 60,       // 25 minutes work
        shortBreakDuration: 5 * 60,  // 5 minutes short break
        longBreakDuration: 15 * 60   // 15 minutes long break
    };
    
    // Get the number of completed work sessions
    const sessionsData = await chrome.storage.local.get('sessionsCompleted');
    const sessionsCompleted = sessionsData.sessionsCompleted || 0;
    // Every 4th break is a long break
    const isLongBreak = sessionsCompleted > 0 && sessionsCompleted % 4 === 0;
    
    // Check if we have a valid running break timer in storage
    if (timerData.timerState && 
        timerData.timerState.mode === 'break' && 
        timerData.timerState.isRunning &&
        timerData.timerState.timerEndTime) {
        
        // Calculate how much time is left in the break
        const now = Date.now();
        const timeRemaining = Math.ceil((timerData.timerState.timerEndTime - now) / 1000);
        
        if (timeRemaining > 0) {
            // If we have time left, continue the existing break
            timeLeft = timeRemaining;
            isBreakActive = true;
            timerEndTime = timerData.timerState.timerEndTime;
            startBreakTimer();
        } else {
            // If time is up, handle the completed break
            breakComplete();
        }
    } else {
        // If no valid break state found, start a new break
        isBreakActive = true;
        // Choose between long or short break based on session count
        timeLeft = isLongBreak ? settings.longBreakDuration : settings.shortBreakDuration;
        startBreakTimer();
    }
    
    // Set up event listeners
    resumeBtn.addEventListener('click', endBreak);  // Handle resume button click
    document.addEventListener('keydown', handleKeyDown);  // Handle keyboard shortcuts
}

/**
 * Displays a random break tip to the user.
 * Tips are selected from the breakTips array defined at the top of the file.
 */
function showRandomTip() {
    // Generate a random index within the breakTips array
    const randomIndex = Math.floor(Math.random() * breakTips.length);
    // Update the tip element with the selected tip
    tipElement.textContent = breakTips[randomIndex];
}

/**
 * Formats a time in seconds into a MM:SS string.
 * @param {number} seconds - The time in seconds to format
 * @returns {string} Formatted time string (e.g., "05:00")
 */
function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);  // Get whole minutes
    const secs = seconds % 60;              // Get remaining seconds
    // Format as MM:SS with leading zeros
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Updates the timer display with the current time left.
 * This is called frequently to show the countdown.
 */
function updateDisplay() {
    timerDisplay.textContent = formatTime(timeLeft);
    
    // Update the UI based on break state
    if (isBreakActive) {
        breakMessage.textContent = 'Take a Break';
        resumeBtn.disabled = true;
    } else {
        breakMessage.textContent = 'Break Complete!';
        resumeBtn.disabled = false;
    }
}

/**
 * Handles keyboard shortcuts for the break page.
 * @param {KeyboardEvent} e - The keyboard event
 */
function handleKeyDown(e) {
    // Allow using Space or Enter to end the break
    if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();  // Prevent default behavior (like scrolling)
        endBreak();
    }
    
    // Block common tab/window close shortcuts
    if (e.ctrlKey && [87, 84, 78, 84, 82].includes(e.keyCode)) {
        e.preventDefault();
        e.stopPropagation();
    }
    
    // Block function keys except F5, F11, F12 (for development)
    if ([112, 114, 116].includes(e.keyCode) && ![116, 122, 123].includes(e.keyCode)) {
        e.preventDefault();
    }
}

// When the page finishes loading, initialize everything
document.addEventListener('DOMContentLoaded', init);
