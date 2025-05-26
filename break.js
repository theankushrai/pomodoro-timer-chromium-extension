// DOM Elements
const timerDisplay = document.getElementById('timer');
const resumeBtn = document.getElementById('resumeBtn');
const breakMessage = document.getElementById('breakMessage');
const tipElement = document.getElementById('tip');

// Break tips
const breakTips = [
    "Look away from the screen and focus on something 20 feet away for 20 seconds",
    "Stand up and stretch your arms, neck, and shoulders",
    "Take a few deep breaths to relax your mind",
    "Close your eyes and relax your facial muscles",
    "Do some gentle neck and shoulder rolls"
];

// State
let timeLeft = 0;
let isBreakActive = true;
let timer;
let timerEndTime = 0;
let lastUpdateTime = 0;

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
    chrome.runtime.sendMessage({ type: 'BREAK_ENDED' });
}

// Initialize the break page
async function init() {
    // Show a random tip
    showRandomTip();
    
    // Load timer state
    const data = await chrome.storage.local.get(['timerState']);
    
    if (data.timerState && data.timerState.mode === 'break') {
        const { timeLeft: savedTime, isRunning: wasRunning, timerEndTime: savedEndTime } = data.timerState;
        timeLeft = savedTime;
        isBreakActive = wasRunning;
        
        if (isBreakActive && savedEndTime) {
            timerEndTime = savedEndTime;
            const now = Date.now();
            if (now >= timerEndTime) {
                breakComplete();
            } else {
                timeLeft = Math.ceil((timerEndTime - now) / 1000);
                startBreakTimer();
            }
        } else {
            updateDisplay();
        }
    } else {
        // Default to 5 minutes if no state found
        timeLeft = 5 * 60;
        updateDisplay();
    }
    
    setupEventListeners();
    
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
    window.addEventListener('popstate', function() {
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
        
        // Allow space to resume when break is over
        if (e.code === 'Space' && !resumeBtn.disabled) {
            e.preventDefault();
            endBreak();
        }
    }, true);
}

function endBreak() {
    clearInterval(timer);
    isBreakActive = false;
    
    // Save the break state before ending
    saveBreakState();
    
    // Send message to popup that break has ended
    chrome.runtime.sendMessage({ type: 'BREAK_ENDED' });
    
    // Close the break page
    window.close();
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
    isBreakActive = false;
    resumeBtn.disabled = false;
    resumeBtn.focus();
    
    // Update message
    breakMessage.textContent = "Break time is over!";
    
    // Play sound
    const breakEndSound = new Audio(chrome.runtime.getURL('sounds/break-end.mp3'));
    breakEndSound.play().catch(e => console.error('Error playing sound:', e));
    
    // Show notification
    showNotification('Break Time Over', {
        body: 'Your break time is over. Ready to get back to work?',
        icon: 'icons/icon48.png'
    });
    
    // Change tip to encourage resuming work
    tipElement.textContent = "Click the button below or press space to resume working";
}

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

function endBreak() {
    clearInterval(timer);
    isBreakActive = false;
    
    // Save the break state before ending
    saveBreakState();
    
    // Send message to popup that break has ended
    chrome.runtime.sendMessage({ type: 'BREAK_ENDED' });
    
    // Close the break page
    window.close();
}

// Display Functions
function updateDisplay() {
    const minutes = Math.floor(timeLeft / 60);
    const seconds = timeLeft % 60;
    timerDisplay.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    
    // Update message based on time remaining
    if (timeLeft <= 0) {
        breakMessage.textContent = "Break time is over!";
    } else if (timeLeft <= 30) {
        breakMessage.textContent = "Almost time to get back to work...";
    }
    
    // Update button state
    resumeBtn.disabled = timeLeft > 0;
}

function showRandomTip() {
    const randomIndex = Math.floor(Math.random() * breakTips.length);
    tipElement.textContent = breakTips[randomIndex];
}

// Helper Functions
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

// Initialize the break page
document.addEventListener('DOMContentLoaded', init);
