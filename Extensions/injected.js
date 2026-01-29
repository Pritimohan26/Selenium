// Injected script that runs in the page context
// This allows us to capture events that might be stopped by page scripts

(function () {
  "use strict";

  // This script runs in the page context and can communicate with content script
  // through custom events

  let originalAddEventListener = EventTarget.prototype.addEventListener;
  let originalRemoveEventListener = EventTarget.prototype.removeEventListener;

  // Track event listeners for better replay
  const eventListeners = new WeakMap();

  EventTarget.prototype.addEventListener = function (type, listener, options) {
    // Store listener info
    if (!eventListeners.has(this)) {
      eventListeners.set(this, new Map());
    }

    const listeners = eventListeners.get(this);
    if (!listeners.has(type)) {
      listeners.set(type, new Set());
    }
    listeners.get(type).add(listener);

    return originalAddEventListener.call(this, type, listener, options);
  };

  EventTarget.prototype.removeEventListener = function (
    type,
    listener,
    options
  ) {
    if (eventListeners.has(this)) {
      const listeners = eventListeners.get(this);
      if (listeners.has(type)) {
        listeners.get(type).delete(listener);
      }
    }

    return originalRemoveEventListener.call(this, type, listener, options);
  };

  // Enhanced event tracking for better selector generation
  window.devToolsRecorderHelpers = {
    // Get comprehensive element information
    getElementInfo: function (element) {
      return {
        tagName: element.tagName,
        id: element.id,
        className: element.className,
        textContent: element.textContent?.trim(),
        attributes: Array.from(element.attributes).reduce((acc, attr) => {
          acc[attr.name] = attr.value;
          return acc;
        }, {}),
        boundingRect: element.getBoundingClientRect(),
        hasEventListeners: eventListeners.has(element),
      };
    },

    // Check if element is interactive
    isInteractive: function (element) {
      const interactiveTags = ["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA"];
      const hasClickHandler =
        eventListeners.has(element) && eventListeners.get(element).has("click");
      const isClickable =
        element.style.cursor === "pointer" || element.getAttribute("onclick");

      return (
        interactiveTags.includes(element.tagName) ||
        hasClickHandler ||
        isClickable ||
        element.getAttribute("role") === "button"
      );
    },

    // Get the best target element (might be parent if current is just text/span)
    getBestTarget: function (element) {
      let current = element;
      let depth = 0;

      while (current && depth < 3) {
        if (this.isInteractive(current)) {
          return current;
        }
        current = current.parentElement;
        depth++;
      }

      return element; // Fallback to original
    },
  };

  // Notify content script that helpers are ready
  window.dispatchEvent(new CustomEvent("devToolsRecorderReady"));
})();
