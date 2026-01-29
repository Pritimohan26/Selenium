// Content script for DevTools-style recorder - Updated to match working version
(function () {
  "use strict";

  // Prevent multiple injections
  if (window.devToolsRecorderInitialized) {
    console.log("DevTools Recorder already initialized, skipping...");
    return;
  }

  console.log("DevTools Recorder content script loading...");

  let isRecording = false;
  let recordedSteps = [];
  let startTime = null;
  let lastStep = null;
  let lastActionTime = 0; // Track last action time separately

  // Generate CSS selector (simplified)
  function generateCSSSelector(element) {
    if (element.id) {
      return `#${element.id}`;
    }

    const path = [];
    let current = element;

    while (current && current.nodeType === Node.ELEMENT_NODE) {
      let selector = current.nodeName.toLowerCase();

      // Special handling for SVG elements
      if (current.namespaceURI === "http://www.w3.org/2000/svg") {
        // For SVG elements, try to use data attributes or classes
        if (current.getAttribute("data-icon")) {
          selector += `[data-icon="${current.getAttribute("data-icon")}"]`;
        } else if (current.className && current.className.baseVal) {
          // SVG elements use className.baseVal
          const classes = current.className.baseVal
            .split(/\s+/)
            .filter((c) => c.length > 0);
          if (classes.length > 0) {
            selector += "." + classes.join(".");
          }
        }
      } else {
        // Regular HTML elements
        if (current.className) {
          const classes = current.className
            .split(/\s+/)
            .filter((c) => c.length > 0 && !c.includes("extension"));
          if (classes.length > 0) {
            selector += "." + classes.join(".");
          }
        }
      }

      // Add nth-of-type if needed
      if (current.parentNode) {
        const siblings = Array.from(current.parentNode.children).filter(
          (sibling) => sibling.nodeName === current.nodeName
        );
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          selector += `:nth-of-type(${index})`;
        }
      }

      path.unshift(selector);
      current = current.parentElement;

      // Stop at body or after 5 levels
      if (
        !current ||
        current.nodeName.toLowerCase() === "body" ||
        path.length >= 5
      ) {
        break;
      }
    }

    return path.join(" > ");
  }

  // Generate multiple selectors (flat array format)
  // HIERARCHICAL: From simplest to most complex
  function generateSelectors(element) {
    const selectors = [];

    try {
      // Find the best clickable target (might be parent of SVG path)
      const clickableTarget = findClickableTarget(element);

      // 1. SIMPLEST: Attribute-based selectors (most specific single attributes)
      // ID selector (if available)
      if (clickableTarget.id) {
        selectors.push(`#${clickableTarget.id}`);
      }

      // Data attribute selectors (very specific)
      const dataIcon = clickableTarget.getAttribute("data-icon");
      if (dataIcon) {
        const tagName = clickableTarget.tagName.toLowerCase();
        selectors.push(`${tagName}[data-icon="${dataIcon}"]`);
      }

      // Aria selector
      const ariaLabel = clickableTarget.getAttribute("aria-label");
      if (ariaLabel && ariaLabel.length < 50) {
        selectors.push(`aria/${ariaLabel}`);
      }

      // 2. SIMPLE: Class-based selectors
      if (clickableTarget.className) {
        const classes = typeof clickableTarget.className === 'string'
          ? clickableTarget.className.split(/\s+/).filter(c => c.length > 0 && !c.includes("extension"))
          : (clickableTarget.className.baseVal || '').split(/\s+/).filter(c => c.length > 0);

        if (classes.length > 0) {
          const tagName = clickableTarget.tagName.toLowerCase();
          selectors.push(`${tagName}.${classes.join('.')}`);
        }
      }

      // 3. MEDIUM: Text content selector
      let textElement = clickableTarget;
      while (textElement && !textElement.textContent?.trim()) {
        textElement = textElement.parentElement;
        if (textElement?.tagName?.toLowerCase() === "body") break;
      }

      const textContent = textElement?.textContent?.trim();
      if (
        textContent &&
        textContent.length < 30 &&
        !textContent.includes("\n")
      ) {
        selectors.push(`text/${textContent}`);
      }

      // 4. MEDIUM-COMPLEX: Parent + current element
      if (clickableTarget.parentElement) {
        const parent = clickableTarget.parentElement;
        const parentSelector = parent.className
          ? `${parent.tagName.toLowerCase()}.${(typeof parent.className === 'string' ? parent.className : parent.className.baseVal || '').split(/\s+/)[0]}`
          : parent.tagName.toLowerCase();

        const currentTag = clickableTarget.tagName.toLowerCase();
        const currentClass = clickableTarget.className
          ? `.${(typeof clickableTarget.className === 'string' ? clickableTarget.className : clickableTarget.className.baseVal || '').split(/\s+/)[0]}`
          : '';

        selectors.push(`${parentSelector} > ${currentTag}${currentClass}`);
      }

      // 5. COMPLEX: Full CSS path (current implementation)
      const cssSelector = generateCSSSelector(clickableTarget);
      if (cssSelector && !selectors.includes(cssSelector)) {
        selectors.push(cssSelector);
      }

      // 6. MOST COMPLEX: XPath as final fallback
      const xpath = generateSimpleXPath(clickableTarget);
      if (xpath) {
        selectors.push(`xpath${xpath}`);
      }
    } catch (error) {
      console.warn("Error generating selectors:", error);
    }

    return selectors.length > 0 ? selectors : [generateCSSSelector(element)];
  }

  // Simple XPath generator
  function generateSimpleXPath(element) {
    const path = [];
    let current = element;

    while (current && current.nodeType === Node.ELEMENT_NODE) {
      let index = 1;
      let sibling = current.previousElementSibling;

      while (sibling) {
        if (sibling.nodeName === current.nodeName) {
          index++;
        }
        sibling = sibling.previousElementSibling;
      }

      const tagName = current.nodeName.toLowerCase();
      path.unshift(`${tagName}[${index}]`);
      current = current.parentElement;

      if (
        !current ||
        current.nodeName.toLowerCase() === "body" ||
        path.length >= 6
      ) {
        break;
      }
    }

    return "//" + path.join("/");
  }

  function isElementClickable(element) {
    if (!element) return false;

    // Check for interactive tags
    const interactiveTags = ["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA"];
    if (interactiveTags.includes(element.tagName)) {
      return true;
    }

    // Check for SVG elements with data-icon attribute (common for icon buttons)
    if (element.tagName && element.tagName.toLowerCase() === "svg" && element.getAttribute("data-icon")) {
      return true;
    }

    // Check for click handlers
    if (element.onclick || element.getAttribute("onclick")) {
      return true;
    }

    // Check for cursor pointer
    const computedStyle = window.getComputedStyle(element);
    if (computedStyle.cursor === "pointer") {
      return true;
    }

    // Check for role attributes
    const role = element.getAttribute("role");
    if (["button", "link", "tab", "menuitem"].includes(role)) {
      return true;
    }

    // Check for common clickable classes/attributes
    const className = element.className || "";
    if (
      typeof className === "string" &&
      (className.includes("btn") ||
        className.includes("button") ||
        className.includes("click") ||
        className.includes("link"))
    ) {
      return true;
    }

    return false;
  }

  // Find the best clickable target for SVG elements
  function findClickableTarget(element) {
    // PRIORITY 1: If clicked on SVG child element (path, circle, etc.), find the SVG root
    if (element.namespaceURI === "http://www.w3.org/2000/svg" && element.tagName.toLowerCase() !== "svg") {
      const svgRoot = element.closest("svg");
      if (svgRoot) {
        // Return the SVG element itself if it has identifying attributes
        if (svgRoot.getAttribute("data-icon") || svgRoot.id || svgRoot.className) {
          console.log("Found SVG root with identifiable attributes:", svgRoot);
          return svgRoot;
        }

        // Otherwise check if SVG's parent is clickable
        if (svgRoot.parentElement && isElementClickable(svgRoot.parentElement)) {
          return svgRoot.parentElement;
        }

        // Default to SVG root anyway (better than path/circle)
        return svgRoot;
      }
    }

    // PRIORITY 2: Walk up the DOM tree to find clickable parent
    let current = element;
    let depth = 0;

    while (current && depth < 5) {
      // Check if current element is clickable
      if (isElementClickable(current)) {
        return current;
      }

      current = current.parentElement;
      depth++;
    }

    return element; // Fallback to original element
  }

  // Add step to recording (simplified to match working version)
  function addStep(step) {
    console.log("addStep called, isRecording:", isRecording);

    if (!isRecording) {
      console.log("Not recording, step ignored");
      return;
    }

    // *** DUPLICATE PREVENTION - ADD THIS ***
    if (step.type === "change") {
      // Check if the last recorded step is the same change event
      const lastStep = recordedSteps[recordedSteps.length - 1];
      if (
        lastStep &&
        lastStep.type === "change" &&
        lastStep.target === step.target &&
        lastStep.value === step.value
      ) {
        console.log(
          "🚫 DUPLICATE PREVENTED:",
          step.target,
          "value:",
          step.value
        );
        return; // Exit function - don't record duplicate
      }
    }
    // *** END DUPLICATE PREVENTION ***

    // Format step to match working version structure
    const formattedStep = {
      type: step.type,
      target: step.target,
      selectors: step.selectors || [], // Flat array
      value: step.value,
      url: step.url,
      timestamp: Date.now(), // FIXED: Use absolute timestamp instead of relative
    };

    // Remove undefined properties
    Object.keys(formattedStep).forEach((key) => {
      if (formattedStep[key] === undefined) {
        delete formattedStep[key];
      }
    });

    // Enhanced duplicate prevention for input fields
    if (formattedStep.type === "change") {
      // Check if we already have a recent change for this target
      const recentChangeIndex = recordedSteps.findIndex((step, index) => {
        return (
          step.type === "change" &&
          step.target === formattedStep.target &&
          index >= Math.max(0, recordedSteps.length - 3)
        ); // Check last 3 steps
      });

      if (recentChangeIndex !== -1) {
        console.log("Replacing previous input step with updated value");
        recordedSteps[recentChangeIndex] = formattedStep;

        // Update storage and send to background
        chrome.storage.local.set({ recordedSteps: recordedSteps });
        chrome.runtime.sendMessage({ type: "recordStep", step: formattedStep });
        return;
      }
    }

    // Prevent duplicate steps - Enhanced logic with real-time checking
    const currentTime = Date.now();
    const realTimeDiff = currentTime - lastActionTime;

    if (
      lastStep &&
      lastStep.type === formattedStep.type &&
      lastStep.target === formattedStep.target
    ) {
      console.log(`Real time difference: ${realTimeDiff}ms between same steps`);

      // FIXED: Reduced threshold to 500ms for clicks to allow intentional multiple clicks
      // Only block rapid accidental double-clicks, not intentional repeated clicks
      const threshold = formattedStep.type === "click" ? 500 : 800;

      if (realTimeDiff < threshold) {
        console.log(
          "Duplicate step prevented:",
          formattedStep.type,
          formattedStep.target?.substring(0, 50)
        );
        console.log(`Blocked: ${realTimeDiff}ms < ${threshold}ms threshold`);
        return;
      }
    }

    // Update last action time
    lastActionTime = currentTime;

    lastStep = formattedStep;
    recordedSteps.push(formattedStep);

    console.log("Step added:", step.type, "Total steps:", recordedSteps.length);

    // Save to chrome storage (matching working version format)
    chrome.storage.local.set(
      {
        recordedSteps: recordedSteps,
        isRecording: isRecording,
      },
      () => {
        if (chrome.runtime.lastError) {
          console.error("Error saving to storage:", chrome.runtime.lastError);
        } else {
          console.log("Step saved to storage successfully");
        }
      }
    );

    // Send to background script (matching working version)
    try {
      chrome.runtime.sendMessage({
        type: "recordStep",
        step: formattedStep,
      });
    } catch (error) {
      console.warn("Could not send message to background:", error);
    }
  }

  // Event handlers
  // REPLACE the existing handleClick function in content.js (around line 120)
  // REPLACE the existing handleClick function with this:
  function handleClick(event) {
    console.log("=== ENHANCED CLICK EVENT START ===");
    console.log("Click detected, isRecording:", isRecording);
    console.log("Target element:", event.target);
    console.log("Target tagName:", event.target.tagName);
    console.log("Target namespace:", event.target.namespaceURI);

    if (!isRecording) {
      console.log("Not recording, click ignored");
      return;
    }

    // Skip extension-related elements
    if (
      event.target.closest("#devtools-recorder-indicator") ||
      event.target.id === "devtools-recorder-indicator"
    ) {
      console.log("Skipping extension indicator click");
      return;
    }

    let targetElement = event.target;

    // Special handling for SVG elements
    if (event.target.namespaceURI === "http://www.w3.org/2000/svg") {
      console.log("🎯 SVG element clicked!");

      // If clicked on a path/child element, try to find the parent SVG or clickable container
      const svgRoot = event.target.closest("svg");
      if (svgRoot) {
        console.log("SVG root found:", svgRoot);
        console.log("SVG data-icon:", svgRoot.getAttribute("data-icon"));
        console.log("SVG classes:", svgRoot.className.baseVal);

        // Check if SVG itself is clickable or if its parent is
        if (isElementClickable(svgRoot)) {
          targetElement = svgRoot;
          console.log("Using SVG root as target");
        } else if (isElementClickable(svgRoot.parentElement)) {
          targetElement = svgRoot.parentElement;
          console.log("Using SVG parent as target");
        }
      }
    }

    console.log("Final target element:", targetElement);
    console.log("Target classes:", targetElement.className);

    const selectors = generateSelectors(targetElement);
    console.log("Generated selectors:", selectors);

    const step = {
      type: "click",
      target: selectors[0],
      selectors: selectors,
    };

    console.log("About to call addStep with:", step);
    addStep(step);
    console.log("=== ENHANCED CLICK EVENT END ===");
  }

  // ADD these new helper functions after the handleClick function

  function isIntentionalClick(element, event) {
    // Check if click has enough duration (not accidental)
    const clickDuration = Date.now() - (element._mouseDownTime || 0);

    // Check if element is actually interactive
    const isInteractive =
      ["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA"].includes(
        element.tagName
      ) ||
      element.onclick ||
      element.getAttribute("role") === "button" ||
      element.getAttribute("role") === "link" ||
      window.getComputedStyle(element).cursor === "pointer";

    return isInteractive && clickDuration > 30; // At least 30ms click duration
  }

  function isSubmitButton(element) {
    return (
      element.type === "submit" ||
      element.textContent?.toLowerCase().includes("sign in") ||
      element.textContent?.toLowerCase().includes("submit") ||
      element.textContent?.toLowerCase().includes("login") ||
      element.textContent?.toLowerCase().includes("confirm")
    );
  }

  function isFormReady(form) {
    console.log("Checking if form is ready...");

    // Get all input fields in the form
    const allInputs = form.querySelectorAll(
      'input[type="text"], input[type="email"], input[type="password"], input:not([type])'
    );
    const requiredFields = form.querySelectorAll("input[required]");

    console.log(
      "Found inputs:",
      allInputs.length,
      "Required:",
      requiredFields.length
    );

    // Check required fields first
    for (let field of requiredFields) {
      if (!field.value.trim()) {
        console.log(
          "Required field empty:",
          field.name || field.id || field.type
        );
        return false;
      }
    }

    // For login forms, check common patterns
    const usernameField = form.querySelector(
      'input[type="text"], input[name*="user"], input[id*="user"]'
    );
    const passwordField = form.querySelector('input[type="password"]');

    if (usernameField && !usernameField.value.trim()) {
      console.log("Username field empty");
      return false;
    }

    if (passwordField && passwordField.value.length < 6) {
      console.log("Password field too short:", passwordField.value.length);
      return false;
    }

    console.log("Form appears ready");
    return true;
  }

  function handleInput(event) {
    if (!isRecording) return;

    const element = event.target;

    // Mark that this field has been interacted with
    element._hasInput = true;

    // Clear existing timeout for this element
    clearTimeout(element._inputTimeout);

    // For immediate feedback, but longer delay
    const delay = element.type === "password" ? 2000 : 1500;

    element._inputTimeout = setTimeout(() => {
      const currentValue = element.value;

      // Only record if user has stopped typing AND field still has focus
      setTimeout(() => {
        if (element.value === currentValue && element._hasInput) {
          const selectors = generateSelectors(element);
          addStep({
            type: "change",
            target: selectors[0],
            selectors: selectors,
            value: currentValue,
          });
          element._hasInput = false; // Reset flag
        }
      }, 500);
    }, delay);
  }

  // ADD this new function for better input handling
  function handleInputBlur(event) {
    if (!isRecording) return;

    const element = event.target;

    // Clear any pending timeout since user left the field
    clearTimeout(element._inputTimeout);

    // FIX 1: Add null check for element.value
    if (element.value && element.value.trim()) {
      const selectors = generateSelectors(element);

      // FIX 2: Check if we already recorded this exact value for this field recently
      const lastRecordedStep = recordedSteps
        .slice() // Create copy
        .reverse() // Start from most recent
        .find((step) => step.type === "change" && step.target === selectors[0]);

      // Only record if the value is different from last recorded value
      // REMOVED the form submission check - we need to record the value even if submitting
      if (!lastRecordedStep || lastRecordedStep.value !== element.value) {
        console.log("Recording final input value on blur:", element.value);
        addStep({
          type: "change",
          target: selectors[0],
          selectors: selectors,
          value: element.value,
        });
      } else {
        console.log(
          "Skipping duplicate blur recording - same value already recorded"
        );
      }
    }

    // Reset input flag
    element._hasInput = false;
  }

  function handleKeyDown(event) {
    if (!isRecording) return;

    // Only record special keys
    if (["Enter", "Tab", "Escape"].includes(event.key)) {
      const element = event.target;
      const selectors = generateSelectors(element);

      addStep({
        type: "keyDown",
        target: selectors[0],
        selectors: selectors,
        key: event.key,
      });
    }
  }

  // Start recording (simplified)
  function startRecording() {
    console.log("Starting recording...");
    isRecording = true;
    startTime = Date.now();
    recordedSteps = [];
    lastStep = null; // Reset last step
    lastActionTime = 0; // Reset last action time

    // Save initial state (matching working version)
    chrome.storage.local.set(
      {
        recordedSteps: recordedSteps,
        isRecording: true,
      },
      () => {
        console.log("Initial recording state saved to storage");
      }
    );

    // Add initial navigation step
    addStep({
      type: "navigate",
      url: window.location.href,
    });

    // Attach event listeners
    // document.addEventListener("click", handleClick, true);
    // document.addEventListener("input", handleInput, true);
    // document.addEventListener("change", handleInput, true);
    // document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("click", handleClick, true);
    document.addEventListener("input", handleInput, true);
    document.addEventListener("change", handleInput, true);
    document.addEventListener("blur", handleInputBlur, true); // ADD this line
    document.addEventListener("keydown", handleKeyDown, true);

    // Show visual indicator
    showRecordingIndicator();

    console.log("Recording started successfully. Event listeners attached.");
  }

  // Stop recording
  function stopRecording() {
    console.log("Stopping recording...");
    isRecording = false;

    // Remove event listeners
    document.removeEventListener("click", handleClick, true);
    document.removeEventListener("input", handleInput, true);
    document.removeEventListener("change", handleInput, true);
    document.removeEventListener("keydown", handleKeyDown, true);
    document.removeEventListener("blur", handleInputBlur, true); // ADD this line

    // Hide visual indicator
    hideRecordingIndicator();

    // Save final state
    chrome.storage.local.set(
      {
        recordedSteps: recordedSteps,
        isRecording: false,
      },
      () => {
        console.log("Final recording state saved to storage");
      }
    );

    console.log("Recording stopped. Total steps:", recordedSteps.length);
    return recordedSteps;
  }

  // Clear recording
  function clearRecording() {
    console.log("Clearing recording...");
    isRecording = false;
    recordedSteps = [];
    lastStep = null; // Reset last step
    lastActionTime = 0; // Reset last action time
    hideRecordingIndicator();

    // Remove event listeners
    document.removeEventListener("click", handleClick, true);
    document.removeEventListener("input", handleInput, true);
    document.removeEventListener("change", handleInput, true);
    document.removeEventListener("keydown", handleKeyDown, true);
    document.removeEventListener("blur", handleInputBlur, true); // ADD this line

    // Clear storage
    chrome.storage.local.set({
      recordedSteps: [],
      isRecording: false,
    });
  }

  // Listen for messages from popup/background
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log(
      "Content script received message:",
      request.action || request.type,
      "Current isRecording:",
      isRecording
    );

    switch (request.action || request.type) {
      case "ping":
        console.log("Ping received, responding...");
        sendResponse({ ready: true });
        break;

      case "startRecording":
        console.log("Start recording request received");
        startRecording();
        sendResponse({ success: true });
        break;

      case "stopRecording":
        console.log("Stop recording request received");
        const recordingData = stopRecording();
        sendResponse({ success: true, recordedSteps: recordingData });
        break;

      case "getStatus":
        console.log(
          "Get status request received - isRecording:",
          isRecording,
          "steps:",
          recordedSteps.length
        );
        sendResponse({
          isRecording,
          recordedSteps,
          stepCount: recordedSteps.length,
        });
        break;

      case "clearRecording":
        console.log("Clear recording request received");
        clearRecording();
        sendResponse({ success: true });
        break;
    }

    return true; // Keep message channel open for async responses
  });

  // Initialize and restore state
  function initializeRecorder() {
    console.log("Initializing recorder, checking storage...");

    // Load previous state from storage (matching working version format)
    chrome.storage.local.get(["recordedSteps", "isRecording"], (result) => {
      console.log("Storage result:", result);

      if (result.isRecording) {
        console.log("Restoring recording state...");
        isRecording = result.isRecording;
        recordedSteps = result.recordedSteps || [];
        startTime = Date.now(); // Reset start time

        // Re-attach event listeners
        document.addEventListener("click", handleClick, true);
        document.addEventListener("input", handleInput, true);
        document.addEventListener("change", handleInput, true);
        document.addEventListener("keydown", handleKeyDown, true);
        document.addEventListener("blur", handleInputBlur, true); // ADD this line

        console.log(
          "Recording state restored. isRecording:",
          isRecording,
          "Current steps:",
          recordedSteps.length
        );

        // Add visual indicator
        showRecordingIndicator();
      } else {
        console.log("No active recording found in storage");
      }
    });
  }

  // Show visual recording indicator
  function showRecordingIndicator() {
    // Remove existing indicator
    const existing = document.getElementById("devtools-recorder-indicator");
    if (existing) existing.remove();

    const indicator = document.createElement("div");
    indicator.id = "devtools-recorder-indicator";
    indicator.innerHTML = "🔴 Recording Actions";
    indicator.style.cssText = `
      position: fixed;
      top: 10px;
      right: 10px;
      background: #ea4335;
      color: white;
      padding: 8px 12px;
      border-radius: 4px;
      font-family: Arial, sans-serif;
      font-size: 12px;
      z-index: 999999;
      box-shadow: 0 2px 10px rgba(0,0,0,0.3);
      animation: pulse 1.5s infinite;
      pointer-events: none;
    `;

    // Add pulse animation
    if (!document.getElementById("recorder-pulse-style")) {
      const style = document.createElement("style");
      style.id = "recorder-pulse-style";
      style.textContent = `
        @keyframes pulse {
          0% { opacity: 1; }
          50% { opacity: 0.7; }
          100% { opacity: 1; }
        }
      `;
      document.head.appendChild(style);
    }

    document.body.appendChild(indicator);
    console.log("Recording indicator shown");
  }

  // Hide visual indicator
  function hideRecordingIndicator() {
    const indicator = document.getElementById("devtools-recorder-indicator");
    if (indicator) {
      indicator.remove();
      console.log("Recording indicator hidden");
    }

    const style = document.getElementById("recorder-pulse-style");
    if (style) {
      style.remove();
    }
  }

  document.addEventListener(
    "mousedown",
    (event) => {
      if (event.target) {
        event.target._mouseDownTime = Date.now();
      }
    },
    true
  );

  // Initialize recorder and restore state
  initializeRecorder();

  // Mark as initialized
  window.devToolsRecorderInitialized = true;
  console.log("DevTools Recorder content script initialized successfully");
})();
