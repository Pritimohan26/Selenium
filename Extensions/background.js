// Background service worker for DevTools-style recorder - Updated to match working version

class RecordingManager {
  constructor() {
    this.initializeState();
  }

  initializeState() {
    chrome.runtime.onInstalled.addListener(() => {
      chrome.storage.local.set({ isRecording: false, recordedSteps: [] });
      console.log("DevTools-style Recorder extension installed");
    });
  }

  startRecording() {
    chrome.storage.local.set({ isRecording: true, recordedSteps: [] });
    this.sendMessageToActiveTab({ action: "startRecording" });
  }

  stopRecording() {
    chrome.storage.local.set({ isRecording: false });
    this.sendMessageToActiveTab({ action: "stopRecording" });
  }

  clearData() {
    chrome.storage.local.set({ recordedSteps: [], isRecording: false });
    this.sendMessageToActiveTab({ action: "clearRecording" });
  }

  // REPLACE the recordStep function in background.js (around line 25)

  recordStep(step) {
    chrome.storage.local.get(
      ["isRecording", "recordedSteps"],
      ({ isRecording, recordedSteps }) => {
        if (!isRecording) return;
        const steps = recordedSteps || [];

        // Filter out extension-related steps and scroll events
        if (
          step.selectors?.some((sel) =>
            sel?.includes("#devtools-recorder-indicator")
          ) ||
          step.type === "scroll"
        ) {
          return;
        }

        // Enhanced duplicate detection
        if (steps.length > 0) {
          const lastStep = steps[steps.length - 1];

          // Check for duplicate change events on same element
          if (
            step.type === "change" &&
            lastStep.type === "change" &&
            step.target === lastStep.target
          ) {
            console.log("Replacing previous input step with updated value");
            steps[steps.length - 1] = step; // Replace instead of adding
            chrome.storage.local.set({ recordedSteps: steps });
            return;
          }

          // Check for rapid duplicate clicks
          if (
            step.type === "click" &&
            lastStep.type === "click" &&
            step.target === lastStep.target
          ) {
            const timeDiff =
              (step.timestamp || Date.now()) -
              (lastStep.timestamp || Date.now());
            if (timeDiff < 500) {
              // FIXED: Reduced to 500ms to match content.js
              console.log("Duplicate click prevented:", step.target);
              return;
            }
          }
        }

        steps.push(step);
        chrome.storage.local.set({ recordedSteps: steps });
        console.log("Step recorded:", step.type, "Total:", steps.length);
      }
    );
  }

  sendDataToAPI(name, description, apiEndpoint, authToken) {
    chrome.storage.local.get("recordedSteps", ({ recordedSteps }) => {
      const now = new Date();
      const title =
        name ||
        `Recording ${now.toLocaleDateString()} at ${now.toLocaleTimeString()}`;

      // Filter and clean steps
      const steps = (recordedSteps || []).filter((s) => {
        if (
          s.selectors?.some((sel) =>
            sel?.includes("#devtools-recorder-indicator")
          )
        ) {
          return false;
        }
        return s.type !== "scroll";
      });

      const dataToSend = {
        title,
        name: name || title,
        description: description || "",
        steps,
      };

      // API call
      if (apiEndpoint && authToken) {
        fetch(apiEndpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${authToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(dataToSend),
        })
          .then((response) => {
            if (!response.ok) throw new Error("Failed to send data to API");
            console.log("✅ API call successful");

            // Clear recorded steps after successful API call
            chrome.storage.local.set({ recordedSteps: [] });
            return response.json();
          })
          .catch((error) => {
            console.error("❌ API submission failed:", error);
          });
      }

      // Always provide download option
      this.downloadRecording(dataToSend);
    });
  }

  downloadRecording(data = null) {
    chrome.storage.local.get("recordedSteps", ({ recordedSteps }) => {
      const now = new Date();
      const title =
        data?.title ||
        `Recording ${now.toLocaleDateString()} at ${now.toLocaleTimeString()}`;

      const steps =
        data?.steps ||
        (recordedSteps || []).filter((s) => {
          if (
            s.selectors?.some((sel) =>
              sel?.includes("#devtools-recorder-indicator")
            )
          ) {
            return false;
          }
          return s.type !== "scroll";
        });

      const dataToExport = { title, steps };
      const jsonData = JSON.stringify(dataToExport, null, 2);
      const dataUrl =
        "data:application/json;charset=utf-8," + encodeURIComponent(jsonData);

      chrome.downloads.download(
        {
          url: dataUrl,
          filename: `recording_${now.getTime()}.json`,
          saveAs: true,
        },
        (downloadId) => {
          if (chrome.runtime.lastError) {
            console.error("Download failed:", chrome.runtime.lastError);
          } else {
            console.log("Recording downloaded successfully");
            // Clear recorded steps after download
            chrome.storage.local.set({ recordedSteps: [] });
          }
        }
      );
    });
  }

  getRecordingStatus() {
    return new Promise((resolve) => {
      chrome.storage.local.get(["isRecording", "recordedSteps"], (result) => {
        resolve({
          isRecording: result.isRecording || false,
          stepCount: (result.recordedSteps || []).length,
          steps: result.recordedSteps || [],
        });
      });
    });
  }

  sendMessageToActiveTab(message) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, message, (response) => {
          if (chrome.runtime.lastError) {
            console.warn(
              "Failed to send message to content script:",
              chrome.runtime.lastError.message
            );
          }
        });
      }
    });
  }

  executeScriptOnActiveTab(func, args) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.scripting.executeScript({
          target: { tabId: tabs[0].id },
          func: func,
          args: args,
        });
      }
    });
  }
}

const recordingManager = new RecordingManager();

// Handle messages from content script and popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("Background received message:", request.type || request.action);

  switch (request.type || request.action) {
    case "startRecording":
      recordingManager.startRecording();
      sendResponse({ success: true });
      break;

    case "stopRecording":
      recordingManager.stopRecording();
      sendResponse({ success: true });
      break;

    case "clearData":
    case "clearRecording":
      recordingManager.clearData();
      sendResponse({ success: true });
      break;

    case "recordStep":
      recordingManager.recordStep(request.step);
      sendResponse({ success: true });
      break;

    case "sendDataToAPI":
      recordingManager.sendDataToAPI(
        request.name,
        request.description,
        request.apiEndpoint,
        request.authToken
      );
      sendResponse({ success: true });
      break;

    case "downloadRecording":
      recordingManager.downloadRecording();
      sendResponse({ success: true });
      break;

    case "getStatus":
      recordingManager.getRecordingStatus().then((status) => {
        sendResponse(status);
      });
      return true; // Keep channel open for async response

    case "stepAdded":
      // Forward step to be recorded
      recordingManager.recordStep(request.step);
      break;

    default:
      console.warn("Unknown message type:", request.type || request.action);
      sendResponse({ success: false, error: "Unknown message type" });
  }

  return true; // Keep message channel open for async responses
});

// Handle extension startup
chrome.runtime.onStartup.addListener(async () => {
  console.log("Extension startup - injecting content scripts");
  const tabs = await chrome.tabs.query({});

  for (const tab of tabs) {
    if (
      tab.url &&
      !tab.url.startsWith("chrome://") &&
      !tab.url.startsWith("chrome-extension://") &&
      !tab.url.startsWith("moz-extension://")
    ) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["content.js"],
        });
      } catch (error) {
        console.warn(`Failed to inject into tab ${tab.id}:`, error.message);
      }
    }
  }
});

// Handle tab updates (for navigation tracking)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (
    changeInfo.status === "complete" &&
    tab.url &&
    !tab.url.startsWith("chrome://") &&
    !tab.url.startsWith("chrome-extension://") &&
    !tab.url.startsWith("moz-extension://")
  ) {
    // Small delay to ensure page is ready
    setTimeout(() => {
      chrome.scripting
        .executeScript({
          target: { tabId: tabId },
          files: ["content.js"],
        })
        .catch((error) => {
          console.warn(
            `Failed to inject into updated tab ${tabId}:`,
            error.message
          );
        });
    }, 500);
  }
});

// Handle tab activation (ensure content script is present)
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (
      tab.url &&
      !tab.url.startsWith("chrome://") &&
      !tab.url.startsWith("chrome-extension://") &&
      !tab.url.startsWith("moz-extension://")
    ) {
      chrome.scripting
        .executeScript({
          target: { tabId: activeInfo.tabId },
          files: ["content.js"],
        })
        .catch(() => {
          // Script might already be injected, ignore error
        });
    }
  } catch (error) {
    console.warn("Failed to handle tab activation:", error.message);
  }
});
