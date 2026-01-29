# PatchGuard Chrome Extension

Chrome extension for recording user interactions and syncing to PatchGuard cloud.

## API Configuration

The extension uses a configurable API base URL. To switch between development and production:

### Development (Local)
Edit `config.js` and ensure the development URL is uncommented:

```javascript
// Development (Local)
const API_BASE_URL = "http://localhost:9000/api";

// Production
// const API_BASE_URL = "https://www.supportplaner.com/v1/api";
```

### Production
Edit `config.js` and ensure the production URL is uncommented:

```javascript
// Development (Local)
// const API_BASE_URL = "http://localhost:9000/api";

// Production
const API_BASE_URL = "https://www.supportplaner.com/v1/api";
```

## Installation

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked"
4. Select the `Extensions` folder
5. The PatchGuard extension should now appear in your extensions

## Reloading After Changes

After making changes to the extension files:
1. Go to `chrome://extensions/`
2. Find PatchGuard extension
3. Click the reload icon (circular arrow)

## Features

- **User Interaction Recording**: Records clicks, inputs, navigation, and scrolls
- **Cloud Sync**: Sync recordings to PatchGuard backend
- **Authentication**: Secure login with JWT tokens
- **Recording Management**: Name and organize your recordings

## Files

- `manifest.json` - Extension configuration
- `popup.html` - Extension popup UI
- `popup.js` - Main popup logic and API integration
- `config.js` - API configuration (switch between dev/prod)
- `content.js` - Content script for recording user actions
- `background.js` - Background service worker
- `injected.js` - Selector generation helper

## API Endpoints Used

- `POST /auth/login` - User authentication (username/password)
- `POST /auth/logout` - User logout
- `POST /recordings` - Create new recording with steps
