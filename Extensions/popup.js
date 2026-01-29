// PatchGuard popup script with API integration - Updated for compatibility
let isRecording = false;
let recording = { title: "", steps: [] };
let startTime = null;
let isLoggedIn = false;
let currentUser = null;
let accessToken = null;

// API Configuration - Loaded from config.js
// Toggle between development and production in config.js file
const API_BASE_URL = window.API_CONFIG?.BASE_URL || "http://localhost:9000/api";

// DOM elements (will be initialized after DOM loads)
let loginScreen,
  mainApp,
  loginForm,
  emailInput,
  passwordInput,
  loginBtn,
  loginMessage;
let startBtn,
  stopBtn,
  clearBtn,
  syncBtn,
  statusText,
  statusDetails,
  stepCount,
  duration;
let userInfo, userEmail, logoutBtn;

// Recording details elements
let recordingDetails, recordingNameInput;

// Compatibility functions for storage format
function convertToOldFormat(recordedSteps) {
  return {
    title: "",
    steps: recordedSteps || [],
  };
}

function convertToNewFormat(recording) {
  return recording.steps || [];
}

// Initialize DOM elements
function initializeDOMElements() {
  // Login elements
  loginScreen = document.getElementById("loginScreen");
  mainApp = document.getElementById("mainApp");
  loginForm = document.getElementById("loginForm");
  emailInput = document.getElementById("email");
  passwordInput = document.getElementById("password");
  loginBtn = document.getElementById("loginBtn");
  loginMessage = document.getElementById("loginMessage");

  // Main app elements
  startBtn = document.getElementById("startBtn");
  stopBtn = document.getElementById("stopBtn");
  clearBtn = document.getElementById("clearBtn");
  syncBtn = document.getElementById("syncBtn");
  statusText = document.getElementById("statusText");
  statusDetails = document.getElementById("statusDetails");
  stepCount = document.getElementById("stepCount");
  duration = document.getElementById("duration");
  userInfo = document.getElementById("userInfo");
  userEmail = document.getElementById("userEmail");
  logoutBtn = document.getElementById("logoutBtn");

  // Recording details elements
  recordingDetails = document.getElementById("recordingDetails");
  recordingNameInput = document.getElementById("recordingName");
}

// Validate recording name with visual feedback
function validateRecordingName() {
  const name = recordingNameInput.value.trim();
  if (!name) {
    // Add error class to main app container for red border
    mainApp.classList.add("error");

    // Also highlight the input field
    recordingNameInput.style.borderColor = "#dc2626";
    recordingNameInput.style.boxShadow = "0 0 0 2px rgba(220, 38, 38, 0.2)";

    // Remove error styling after 2 seconds
    setTimeout(() => {
      mainApp.classList.remove("error");
      recordingNameInput.style.borderColor = "#e5e5e5";
      recordingNameInput.style.boxShadow = "none";
    }, 2000);

    return false;
  }

  // Reset to normal state if valid
  mainApp.classList.remove("error");
  recordingNameInput.style.borderColor = "#e5e5e5";
  recordingNameInput.style.boxShadow = "none";
  return true;
}

// API Functions
async function loginAPI(username, password) {
  try {
    const response = await fetch(`${API_BASE_URL}/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ username, password }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || "Login failed");
    }

    return data;
  } catch (error) {
    throw new Error(
      error.message || "Network error. Please check your connection."
    );
  }
}

// Add this function to your popup.js file (around line 150, after the loginAPI function)

async function syncRecordingAPI(recordingData, token) {
  try {
    const response = await fetch(`${API_BASE_URL}/extension/recordings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(recordingData),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || "Sync failed");
    }

    return data;
  } catch (error) {
    throw new Error(
      error.message || "Network error. Please check your connection."
    );
  }
}

// Sync recording function
async function syncRecording() {
  // Validate recording name before syncing
  if (!validateRecordingName()) {
    statusText.innerHTML = "<strong>Please enter a recording name</strong>";
    statusText.style.color = "#dc2626";
    setTimeout(() => {
      statusText.textContent =
        recording.steps.length > 0 ? "Recording completed" : "Ready to record";
      statusText.style.color = "#2f2f2f";
    }, 3000);
    return;
  }

  if (!accessToken || recording.steps.length === 0) return;

  // Disable sync button and show loading
  syncBtn.disabled = true;
  syncBtn.textContent = "Syncing...";
  syncBtn.style.background = "#6b7280"; // Gray while loading

  try {
    // Filter out duplicate steps before sending to API
    const filteredSteps = removeDuplicateSteps(recording.steps);

    console.log(
      `Original steps: ${recording.steps.length}, Filtered steps: ${filteredSteps.length}`
    );
    console.log(
      "Duplicates removed:",
      recording.steps.length - filteredSteps.length
    );

    const userRecordingName = recordingNameInput.value.trim();

    // Add timestamp to prevent duplicates
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .slice(0, -5); // Format: 2025-08-01T08-41-03
    const recordingName = `${userRecordingName}_${timestamp}`;

    const recordingData = {
      title: recordingName,
      description: `Recording created from Chrome extension on ${new Date().toLocaleDateString()}`,
      status: "draft",
      steps: filteredSteps.map((step) => {
        const { timestamp, ...cleanStep } = step;
        return cleanStep;
      }),
      metadata: {
        createdFrom: "chrome_extension",
        userEnteredName: userRecordingName,
        generatedAt: new Date().toISOString(),
      },
    };

    console.log("Sending recording data:", recordingData);

    const response = await syncRecordingAPI(recordingData, accessToken);

    if (response.success) {
      // Show success in status message
      const originalStatusText = statusText.textContent;
      statusText.innerHTML =
        "<strong>Recording synced to cloud successfully!</strong>";
      statusText.style.color = "#059669";

      // Update sync button - keep it disabled after successful sync
      syncBtn.textContent = "Synced Successfully";
      syncBtn.style.background = "#059669";
      syncBtn.disabled = true; // Keep disabled after successful sync

      // Reset status message after 3 seconds but keep button disabled
      setTimeout(() => {
        statusText.textContent = originalStatusText;
        statusText.style.color = "#2f2f2f";
      }, 3000);

      console.log("Sync successful:", response.data);
    }
  } catch (error) {
    // Show error in status message
    const originalStatusText = statusText.textContent;
    statusText.innerHTML =
      "<strong>Sync failed: " + error.message + "</strong>";
    statusText.style.color = "#dc2626";

    // Update sync button
    syncBtn.textContent = "Sync Failed - Retry";
    syncBtn.style.background = "#dc2626";

    // Reset after 4 seconds to allow retry
    setTimeout(() => {
      statusText.textContent = originalStatusText;
      statusText.style.color = "#2f2f2f";
      syncBtn.textContent = "Sync to Cloud";
      syncBtn.style.background = "#059669";
      syncBtn.disabled = false; // Re-enable for retry
    }, 4000);

    console.error("Sync error:", error.message);
  }
}

// Authentication Functions
function showMessage(message, isError = false) {
  loginMessage.innerHTML = `<div class="${
    isError ? "error-message" : "success-message"
  }">${message}</div>`;
  setTimeout(() => {
    loginMessage.innerHTML = "";
  }, 5000);
}

function setLoading(isLoading) {
  loginBtn.disabled = isLoading;
  loginBtn.textContent = isLoading ? "Signing in..." : "Sign In";
  emailInput.disabled = isLoading;
  passwordInput.disabled = isLoading;
}

async function handleLogin(username, password) {
  setLoading(true);

  try {
    const response = await loginAPI(username, password);

    if (response.success) {
      // Store user data and token
      currentUser = response.data.user;
      accessToken = response.data.token;

      // Save to chrome storage
      await chrome.storage.local.set({
        isLoggedIn: true,
        currentUser: currentUser,
        accessToken: accessToken,
      });

      showMessage("Login successful!");
      setTimeout(() => showMainApp(), 1000);
    }
  } catch (error) {
    showMessage(error.message, true);
  } finally {
    setLoading(false);
  }
}

async function logout() {
  // Call logout API if token exists
  if (accessToken) {
    try {
      await fetch(`${API_BASE_URL}/auth/logout`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
        },
      });
    } catch (error) {
      console.error("Logout API error:", error);
    }
  }

  // Clear all stored data
  chrome.storage.local.remove([
    "isLoggedIn",
    "currentUser",
    "accessToken",
    "recordedSteps", // Clear recorded steps too
  ]);

  // Reset variables
  isLoggedIn = false;
  currentUser = null;
  accessToken = null;

  // Reset forms
  emailInput.value = "";
  passwordInput.value = "";

  showLoginScreen();
}

// Screen Management
function showLoginScreen() {
  loginScreen.classList.remove("hidden");
  mainApp.classList.add("hidden");
  if (emailInput) {
    emailInput.focus();
  }
}

function showMainApp() {
  loginScreen.classList.add("hidden");
  mainApp.classList.remove("hidden");
  isLoggedIn = true;

  // Update user info
  if (currentUser) {
    userEmail.textContent = currentUser.username || currentUser.email || currentUser.name;
  }

  loadCurrentState();
}

function checkLoginStatus() {
  chrome.storage.local.get(
    ["isLoggedIn", "currentUser", "accessToken"],
    (result) => {
      if (result.isLoggedIn && result.currentUser && result.accessToken) {
        currentUser = result.currentUser;
        accessToken = result.accessToken;
        showMainApp();
      } else {
        showLoginScreen();
      }
    }
  );
}

// Recording Functions
async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function ensureContentScriptReady(tabId, retries = 3) {
  return new Promise((resolve) => {
    const checkReady = (attempt = 0) => {
      if (attempt >= retries) {
        chrome.scripting
          .executeScript({
            target: { tabId: tabId },
            files: ["content.js"],
          })
          .then(() => {
            setTimeout(() => {
              chrome.tabs.sendMessage(tabId, { action: "ping" }, (response) => {
                resolve(!chrome.runtime.lastError && response);
              });
            }, 1000);
          })
          .catch(() => {
            resolve(false);
          });
        return;
      }

      chrome.tabs.sendMessage(tabId, { action: "ping" }, (response) => {
        if (chrome.runtime.lastError) {
          setTimeout(() => checkReady(attempt + 1), 500);
        } else {
          resolve(true);
        }
      });
    };

    checkReady();
  });
}

function updateUI() {
  if (isRecording) {
    statusText.innerHTML =
      '<span class="recording-indicator"></span>Recording in progress...';
    startBtn.textContent = "Recording...";
    startBtn.classList.add("recording");
    startBtn.disabled = true;
    stopBtn.disabled = false;
    syncBtn.disabled = true;
    clearBtn.disabled = true;

    // NEW: Show recording details section when recording starts
    recordingDetails.classList.add("active");
  } else {
    statusText.textContent =
      recording.steps.length > 0 ? "Recording completed" : "Ready to record";
    startBtn.textContent = "Start Recording";
    startBtn.classList.remove("recording");
    startBtn.disabled = false;
    stopBtn.disabled = true;
    syncBtn.disabled = recording.steps.length === 0;
    clearBtn.disabled = false;

    // NEW: Hide recording details section when not recording
    if (recording.steps.length === 0) {
      recordingDetails.classList.remove("active");
      // Clear recording name when clearing recording
      recordingNameInput.value = "";
    }
  }

  stepCount.textContent = recording.steps.length;

  // Update duration
  if (isRecording && startTime) {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    duration.textContent = `${elapsed}s`;
  } else {
    duration.textContent = "0s";
  }
}

async function loadCurrentState() {
  if (!isLoggedIn) return;

  try {
    const tab = await getCurrentTab();

    // Skip chrome:// and extension pages
    if (
      tab.url.startsWith("chrome://") ||
      tab.url.startsWith("chrome-extension://") ||
      tab.url.startsWith("edge://")
    ) {
      statusText.textContent = "Cannot record on this page";
      startBtn.disabled = true;
      return;
    }

    // Check chrome storage for persisted state - UPDATED FORMAT
    chrome.storage.local.get(
      ["recordedSteps", "isRecording"], // Changed from 'recording' to 'recordedSteps'
      (result) => {
        if (result.isRecording !== undefined) {
          isRecording = result.isRecording;
          // Convert new format to old format for compatibility
          recording = convertToOldFormat(result.recordedSteps);
          updateUI();
        }
      }
    );

    const isReady = await ensureContentScriptReady(tab.id);

    if (!isReady) {
      statusText.textContent = "Content script failed to load. Try refreshing.";
      startBtn.disabled = true;
      return;
    }

    // Get current state from content script
    chrome.tabs.sendMessage(tab.id, { action: "getStatus" }, (response) => {
      if (chrome.runtime.lastError) {
        return;
      }

      if (response) {
        isRecording = response.isRecording;
        // Handle both old and new response formats
        if (response.recordedSteps) {
          recording = convertToOldFormat(response.recordedSteps);
        } else if (response.recording) {
          recording = response.recording;
        }
        updateUI();
      }
    });
  } catch (error) {
    statusText.textContent = "Error loading state";
    startBtn.disabled = true;
  }
}

function removeDuplicateSteps(steps) {
  if (!steps || steps.length === 0) return [];

  const filtered = [];

  for (let i = 0; i < steps.length; i++) {
    const currentStep = steps[i];

    // Always keep navigate steps
    if (currentStep.type === "navigate") {
      filtered.push(currentStep);
      continue;
    }

    // For change steps, check if it's a duplicate of the previous step
    if (currentStep.type === "change") {
      const lastStep = filtered[filtered.length - 1];

      // Skip if last step is identical change
      if (
        lastStep &&
        lastStep.type === "change" &&
        lastStep.target === currentStep.target &&
        lastStep.value === currentStep.value
      ) {
        console.log(
          "🚫 Removing duplicate change step:",
          currentStep.target,
          currentStep.value
        );
        continue; // Skip this duplicate step
      }
    }

    // For click steps, check for rapid duplicates
    if (currentStep.type === "click") {
      const lastStep = filtered[filtered.length - 1];

      // Skip if last step is identical click within short time
      if (
        lastStep &&
        lastStep.type === "click" &&
        lastStep.target === currentStep.target
      ) {
        const timeDiff =
          (currentStep.timestamp || 0) - (lastStep.timestamp || 0);
        if (timeDiff < 2000) {
          // Less than 2 seconds
          console.log("🚫 Removing duplicate click step:", currentStep.target);
          continue; // Skip this duplicate step
        }
      }
    }

    // Keep this step
    filtered.push(currentStep);
  }

  console.log(
    `Original steps: ${steps.length}, After removing duplicates: ${filtered.length}`
  );
  return filtered;
}

// Event Handlers
function setupLoginHandler() {
  loginForm.addEventListener("submit", (e) => {
    e.preventDefault();

    const username = emailInput.value.trim();
    const password = passwordInput.value.trim();

    if (!username || !password) {
      showMessage("Please enter both username and password.", true);
      return;
    }

    handleLogin(username, password);
  });
}

function setupEventListeners() {
  // Logout handler
  logoutBtn.addEventListener("click", logout);

  // Recording name validation on input
  recordingNameInput.addEventListener("input", () => {
    validateRecordingName();
  });

  // Recording handlers
  startBtn.addEventListener("click", async () => {
    try {
      const tab = await getCurrentTab();
      const isReady = await ensureContentScriptReady(tab.id);

      if (!isReady) {
        statusText.textContent = "Failed to initialize recorder";
        return;
      }

      chrome.tabs.sendMessage(
        tab.id,
        { action: "startRecording" },
        (response) => {
          if (chrome.runtime.lastError) {
            statusText.textContent = "Error starting recording";
            return;
          }

          if (response?.success) {
            isRecording = true;
            startTime = Date.now();
            recording = { title: "", steps: [] };
            updateUI();

            // Start duration timer
            const timer = setInterval(() => {
              if (!isRecording) {
                clearInterval(timer);
                return;
              }
              updateUI();
            }, 1000);

            // Close popup after starting
            setTimeout(() => window.close(), 1000);
          }
        }
      );
    } catch (error) {
      statusText.textContent = "Error starting recording";
    }
  });

  stopBtn.addEventListener("click", async () => {
    try {
      const tab = await getCurrentTab();
      chrome.tabs.sendMessage(
        tab.id,
        { action: "stopRecording" },
        (response) => {
          if (response?.success) {
            isRecording = false;
            startTime = null;
            // Handle new response format
            if (response.recordedSteps) {
              recording = convertToOldFormat(response.recordedSteps);
            } else if (response.recording) {
              recording = response.recording;
            }
            updateUI();
          }
        }
      );
    } catch (error) {
      statusText.textContent = "Error stopping recording";
    }
  });

  // Updated clear button event handler (replace in setupEventListeners)
  clearBtn.addEventListener("click", async () => {
    try {
      // Clear new storage format
      chrome.storage.local.remove(["recordedSteps", "isRecording"]);

      const tab = await getCurrentTab();
      chrome.tabs.sendMessage(
        tab.id,
        { action: "clearRecording" },
        (response) => {
          recording = { title: "", steps: [] };
          isRecording = false;
          startTime = null;

          // Reset sync button when clearing recording
          syncBtn.textContent = "Sync to Cloud";
          syncBtn.style.background = "#059669";
          syncBtn.disabled = true; // Disabled because no recording to sync

          // Clear recording name
          recordingNameInput.value = "";

          updateUI();
        }
      );
    } catch (error) {
      // Clear UI anyway
      recording = { title: "", steps: [] };
      isRecording = false;
      startTime = null;

      // Reset sync button
      syncBtn.textContent = "Sync to Cloud";
      syncBtn.style.background = "#059669";
      syncBtn.disabled = true;

      // Clear recording name
      recordingNameInput.value = "";

      updateUI();
    }
  });

  // Sync handler
  syncBtn.addEventListener("click", syncRecording);
}

// Initialize everything when DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
  initializeDOMElements();
  setupLoginHandler();
  setupEventListeners();

  // Listen for messages from content script - UPDATED
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "stepAdded" || request.type === "recordStep") {
      // Handle both message formats
      const step = request.step;
      if (step) {
        recording.steps.push(step);
        updateUI();
      }
    }
  });

  checkLoginStatus();
});
