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
    clearInterval(timer);
    isBreakActive = false;
    resumeBtn.disabled = false;  // Enable the resume button
    resumeBtn.textContent = 'Resume Working';
    updateDisplay();
    
    try {
        // Get the list of tabs we need to restore from Chrome storage
        const data = await chrome.storage.local.get('originalTabUrls');
        
        // If we have tabs to restore...
        if (data.originalTabUrls) {
            // Parse the stored tab data (it was stored as a JSON string)
            const tabsToRestore = JSON.parse(data.originalTabUrls);
            
            // Restore each tab to its original URL
            for (const tab of tabsToRestore) {
                try {
                    // Update the tab's URL back to its original
                    await chrome.tabs.update(tab.tabId, { url: tab.url });
                } catch (error) {
                    // If a tab can't be restored (maybe it was closed), just log a warning
                    console.warn(`Failed to restore tab ${tab.tabId}:`, error);
                }
            }
            
            // Clean up the stored URLs since we're done with them
            await chrome.storage.local.remove('originalTabUrls');
        }
        
        // Notify the popup that the break has ended
        await chrome.runtime.sendMessage({ type: 'BREAK_ENDED' });
    } catch (error) {
        // If anything goes wrong, log the error but don't crash
        console.log('Error during break completion:', error);
    }
}

/**
 * Ends the break early when the user clicks 'Resume Working'.
 * This function restores all tabs to their original state and cleans up.
 */
async function endBreak() {
    // Stop any running timers and update the break state
    clearInterval(timer);
    isBreakActive = false;
    
    // Save the current state before making changes
    saveBreakState();
    
    try {
        // Get both the stored tab URLs and all currently open tabs in parallel
        const [data, allTabs] = await Promise.all([
            chrome.storage.local.get('originalTabUrls'),  // Get stored tab data
            chrome.tabs.query({})  // Get all currently open tabs
        ]);
        
        // If we have tabs to restore...
        if (data.originalTabUrls) {
            // Parse the stored tab data
            const tabsToRestore = JSON.parse(data.originalTabUrls);
            const restorePromises = [];  // Will store all our tab restoration promises
            
            // Get the URL of the break page (so we can identify break tabs)
            const breakUrl = chrome.runtime.getURL('break.html');
            
            // Find all tabs that are currently showing the break page
            const breakTabs = allTabs.filter(tab => 
                tab.url && tab.url.includes('break.html')
            );
            
            // Close all break tabs (including this one)
            // First filter out any invalid tab IDs, then create close promises
            const closePromises = breakTabs
                .filter(tab => tab.id !== null && tab.id !== undefined)
                .map(tab => chrome.tabs.remove(tab.id).catch(e => 
                    console.warn(`Failed to close tab ${tab.id}:`, e)
                ));
            
            // Restore each tab to its original URL
            for (const tab of tabsToRestore) {
                if (tab.tabId !== null && tab.tabId !== undefined) {
                    // For each tab, create a promise to restore its URL
                    restorePromises.push(
                        chrome.tabs.update(tab.tabId, { 
                            url: tab.url,  // Original URL
                            active: false  // Don't switch to this tab
                        }).catch(error => {
                            console.warn(`Failed to restore tab ${tab.tabId}:`, error);
                            return null;  // Continue even if one tab fails
                        })
                    );
                }
            }
            
            // Wait for all tab operations to complete (both closing breaks and restoring tabs)
            await Promise.all([...restorePromises, ...closePromises]);
            
            // Clean up our stored data since we're done with it
            await chrome.storage.local.remove(['originalTabUrls', 'lastActiveUrl']);
            
            // Notify the popup that the break was ended
            await chrome.runtime.sendMessage({ type: 'BREAK_ENDED' });
            
            // Close this break page (we're done with it)
            window.close();
        } else {
            // If we couldn't find any tabs to restore, still try to clean up
            console.warn('No original tab URLs found for restoration');
            await chrome.runtime.sendMessage({ type: 'BREAK_ENDED' });
            window.close();
        }
    } catch (error) {
        // If anything goes wrong, log the error but still try to close
        console.error('Error during break end:', error);
        window.close();
    }
}

/**
 * Initializes the break page when it loads.
 * Sets up the timer, loads settings, and restores any existing break state.
 */
async function init() {
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
