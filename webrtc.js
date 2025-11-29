// Dell Remote Desktop - Multi-Channel WebRTC Client
// Direct Input Architecture: Keyboard/Mouse → UnifiedCaptureHelper, Control → Service

const SIGNALING_SERVER_URL = "wss://signalling-server-oxaw.onrender.com/ws";
const DEVICE_ID = "device001";
const AUTH_CODE = "secret";

// WDA Service Configuration
let WDA_SERVICE_IP = null;
let WDA_SERVICE_PORT = 8080;

// Enhanced ICE server configuration
const rtcConfig = {
  iceServers: [
    { urls: "stun:stun.relay.metered.ca:80" }
  ],
  iceCandidatePoolSize: 10,
  iceTransportPolicy: 'all'
};

// UI Elements
const videoEl = document.getElementById("remoteVideo");
const videoContainer = document.getElementById("videoContainer");
const videoWrapper = document.getElementById("videoWrapper");
const loadingScreen = document.getElementById("loadingScreen");
const statusText = document.getElementById("statusText");
const statusDot = document.getElementById("statusDot");
const counterDisplay = document.getElementById("counterDisplay");
const qualityInfo = document.getElementById("qualityInfo");
const fullscreenOverlay = document.getElementById("fullscreenOverlay");

// Channel status indicators
const controlChannelDot = document.getElementById("controlChannelDot");
const inputChannelDot = document.getElementById("inputChannelDot");
const mouseChannelDot = document.getElementById("mouseChannelDot");
const channelText = document.getElementById("channelText");

// Toolbar buttons
const fitScreenBtn = document.getElementById("fitScreenBtn");
const fullscreenBtn = document.getElementById("fullscreenBtn");
const exitFullscreenBtn = document.getElementById("exitFullscreenBtn");
const disconnectBtn = document.getElementById("disconnectBtn");
const screenshotBtn = document.getElementById("screenshotBtn");
const recordBtn = document.getElementById("recordBtn");
const recordIcon = document.getElementById("recordIcon");
const appsBtn = document.getElementById("appsBtn");
const appsDropdown = document.getElementById("appsDropdown");
const tooltipTrigger = document.getElementById("tooltipTrigger");
const tooltipPanel = document.getElementById("tooltipPanel");

// WebRTC and Channel variables
let socket, pc;
let controlChannel = null;
let inputChannel = null;
let mouseChannel = null;
let isFullscreen = false;
let connectionStats = { bitrate: 0, latency: 0 };

// Recording variables
let mediaRecorder = null;
let recordedChunks = [];
let isRecording = false;

// Input handling state
let mouseState = {
  clientWidth: 0,
  clientHeight: 0,
  capturing: false
};

// Keyboard event deduplication
let keyboardState = {
  lastKeyEvent: null,
  lastKeyTime: 0,
  pressedKeys: new Set()
};

// MessagePack encoding for ultra-fast input transmission
function msgpackEncode(obj) {
  return JSON.stringify(obj);
}

function log(...args) { 
  console.log("[Dell Remote Desktop]", ...args); 
}

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `dell-toast ${type}`;
  toast.innerHTML = `
    <div style="font-weight: 500; margin-bottom: 4px;">Dell Remote Desktop</div>
    <div style="font-size: var(--dell-font-size-sm); color: var(--dell-gray-600);">${message}</div>
  `;
  
  document.body.appendChild(toast);
  
  setTimeout(() => toast.classList.add('show'), 100);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// WDA Service Control Functions
async function callWDAService(endpoint) {
  if (!WDA_SERVICE_IP) {
    log('❌ WDA Service IP not configured');
    showToast('WDA Service IP not configured', 'error');
    return false;
  }

  const url = `http://${WDA_SERVICE_IP}:${WDA_SERVICE_PORT}/${endpoint}`;
  
  try {
    log(`📞 Calling WDA Service: ${url}`);
    const response = await fetch(url, {
      method: 'GET',
      mode: 'cors',
      headers: {
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    log(`✅ WDA Service response:`, data);
    return data;
  } catch (error) {
    log(`❌ WDA Service error:`, error);
    showToast(`WDA Service error: ${error.message}`, 'error');
    return null;
  }
}

async function connectRemoteService() {
  log('🔌 Connecting to remote service...');
  showToast('Starting MyDellSecureDesktopLauncher service...', 'info');
  
  const result = await callWDAService('connectremote');
  
  if (result && result.status === 'success') {
    log('✅ Remote service started successfully');
    showToast('Service started successfully', 'success');
    return true;
  } else {
    log('❌ Failed to start remote service');
    showToast('Failed to start remote service', 'error');
    return false;
  }
}

async function disconnectRemoteService() {
  log('🔌 Disconnecting from remote service...');
  showToast('Stopping MyDellSecureDesktopLauncher service...', 'info');
  
  const result = await callWDAService('disconnectremote');
  
  if (result && result.status === 'success') {
    log('✅ Remote service stopped successfully');
    showToast('Service stopped successfully', 'success');
    return true;
  } else {
    log('❌ Failed to stop remote service');
    showToast('Failed to stop remote service', 'warning');
    return false;
  }
}

function promptForDeviceIP() {
  return new Promise((resolve) => {
    // Create modal overlay
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.7);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    `;

    // Create modal dialog
    const dialog = document.createElement('div');
    dialog.style.cssText = `
      background: white;
      border-radius: 8px;
      padding: 24px;
      width: 400px;
      max-width: 90%;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
    `;

    dialog.innerHTML = `
      <div style="display: flex; align-items: center; margin-bottom: 20px;">
        <svg width="32" height="32" viewBox="0 0 32 32" style="margin-right: 12px;">
          <rect width="32" height="32" rx="6" fill="#0076CE"/>
          <path d="M8 12h16v2H8zm0 4h16v2H8zm0 4h10v2H8z" fill="white"/>
        </svg>
        <h2 style="margin: 0; font-size: 20px; font-weight: 600; color: #333;">
          WDA Mock Service Configuration
        </h2>
      </div>
      
      <p style="margin: 0 0 16px 0; color: #666; font-size: 14px;">
        Enter the IP address of the device running the mockWDA service:
      </p>
      
      <input 
        type="text" 
        id="ipInput" 
        placeholder="e.g., 192.168.1.100" 
        value="localhost"
        style="
          width: 100%;
          padding: 10px 12px;
          border: 2px solid #ddd;
          border-radius: 4px;
          font-size: 14px;
          box-sizing: border-box;
          margin-bottom: 20px;
        "
      />
      
      <div style="display: flex; gap: 12px; justify-content: flex-end;">
        <button 
          id="cancelBtn"
          style="
            padding: 10px 20px;
            border: 1px solid #ddd;
            border-radius: 4px;
            background: white;
            color: #333;
            font-size: 14px;
            cursor: pointer;
            font-weight: 500;
          "
        >
          Cancel
        </button>
        <button 
          id="connectBtn"
          style="
            padding: 10px 20px;
            border: none;
            border-radius: 4px;
            background: #0076CE;
            color: white;
            font-size: 14px;
            cursor: pointer;
            font-weight: 500;
          "
        >
          Connect
        </button>
      </div>
    `;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const ipInput = dialog.querySelector('#ipInput');
    const connectBtn = dialog.querySelector('#connectBtn');
    const cancelBtn = dialog.querySelector('#cancelBtn');

    // Focus input
    ipInput.focus();
    ipInput.select();

    // Handle connect button
    const handleConnect = () => {
      const ip = ipInput.value.trim();
      if (ip) {
        WDA_SERVICE_IP = ip;
        log(`✅ WDA Service IP configured: ${ip}`);
        document.body.removeChild(overlay);
        resolve(ip);
      } else {
        ipInput.style.borderColor = '#e74c3c';
        showToast('Please enter a valid IP address', 'error');
      }
    };

    // Handle cancel button
    const handleCancel = () => {
      document.body.removeChild(overlay);
      resolve(null);
    };

    connectBtn.addEventListener('click', handleConnect);
    cancelBtn.addEventListener('click', handleCancel);
    
    // Enter key to connect
    ipInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        handleConnect();
      }
    });

    // Hover effects
    connectBtn.addEventListener('mouseenter', () => {
      connectBtn.style.background = '#005a9e';
    });
    connectBtn.addEventListener('mouseleave', () => {
      connectBtn.style.background = '#0076CE';
    });

    cancelBtn.addEventListener('mouseenter', () => {
      cancelBtn.style.background = '#f5f5f5';
    });
    cancelBtn.addEventListener('mouseleave', () => {
      cancelBtn.style.background = 'white';
    });
  });
}

function updateStatus(text, connected = false) { 
  if (statusText) {
    statusText.textContent = text;
  }
  if (statusDot) {
    statusDot.className = connected ? 'dell-status-dot connected' : 'dell-status-dot';
  }
  
  if (connected && loadingScreen) {
    loadingScreen.classList.add('hidden');
    if (screenshotBtn) {
      screenshotBtn.disabled = false;
    }
    showToast('Connection established successfully', 'success');
  }
}

function updateChannelStatus(channel, connected) {
  const dots = { control: controlChannelDot, input: inputChannelDot, mouse: mouseChannelDot };
  if (dots[channel]) {
    dots[channel].className = connected ? 'dell-status-dot connected' : 'dell-status-dot';
  }
}

function updateCounter(text) { 
  if (counterDisplay) {
    counterDisplay.textContent = text;
    counterDisplay.classList.add('visible');
  }
}

function updateQuality(info) {
  if (qualityInfo) {
    qualityInfo.textContent = info;
  }
}

// Direct Input Handling Functions

function sendKeyboardEvent(eventData) {
  if (!inputChannel || inputChannel.readyState !== 'open') {
    return false;
  }

  const now = Date.now();
  const keyId = eventData.code || eventData.key;
  const eventKey = `${eventData.type}-${keyId}`;
  
  if (keyboardState.lastKeyEvent === eventKey && (now - keyboardState.lastKeyTime) < 50) {
    console.log('[DEBUG] Ignoring duplicate keyboard event:', eventKey);
    return false;
  }
  
  if (eventData.type === 'keydown') {
    if (keyboardState.pressedKeys.has(keyId)) {
      console.log('[DEBUG] Key already pressed, ignoring duplicate keydown:', keyId);
      return false;
    }
    keyboardState.pressedKeys.add(keyId);
  } else if (eventData.type === 'keyup') {
    if (!keyboardState.pressedKeys.has(keyId)) {
      console.log('[DEBUG] Key not pressed, ignoring orphaned keyup:', keyId);
      return false;
    }
    keyboardState.pressedKeys.delete(keyId);
  }
  
  keyboardState.lastKeyEvent = eventKey;
  keyboardState.lastKeyTime = now;

  try {
    const message = msgpackEncode({
      type: eventData.type,
      key: eventData.key,
      code: eventData.code,
      ctrlKey: eventData.ctrlKey,
      altKey: eventData.altKey,
      shiftKey: eventData.shiftKey,
      timestamp: now
    });

    inputChannel.send(message);
    console.log('[DEBUG] Sent keyboard event:', eventData.type, eventData.key);
    return true;
  } catch (error) {
    console.error('[DEBUG] Error sending keyboard event:', error);
    return false;
  }
}

function sendMouseEvent(eventData) {
  console.log('[DEBUG] sendMouseEvent called with:', eventData.type, eventData.clientX, eventData.clientY);
  
  if (!mouseChannel) {
    console.log('[DEBUG] Mouse channel is null');
    log('⚠️ Mouse channel not available for mouse event');
    return false;
  }
  
  if (mouseChannel.readyState !== 'open') {
    console.log('[DEBUG] Mouse channel state:', mouseChannel.readyState);
    log('⚠️ Mouse channel not ready for mouse event, state:', mouseChannel.readyState);
    return false;
  }

  try {
    const rect = videoEl.getBoundingClientRect();
    const relativeX = Math.max(0, Math.min(rect.width, eventData.clientX - rect.left));
    const relativeY = Math.max(0, Math.min(rect.height, eventData.clientY - rect.top));

    const normX = Math.round((relativeX / Math.max(1, rect.width)) * 65535);
    const normY = Math.round((relativeY / Math.max(1, rect.height)) * 65535);
    
    const message = msgpackEncode({
      type: eventData.type,
      x: normX,
      y: normY,
      button: eventData.button || 0,
      deltaY: eventData.deltaY || 0,
      timestamp: Date.now(),
      normalized: true
    });

    console.log('[DEBUG] Sending mouse message:', message);
    mouseChannel.send(message);
    console.log('[DEBUG] Mouse message sent successfully');
    
    if (eventData.type !== 'mousemove' || Date.now() % 1000 === 0) {
      log('🖱️ Sent mouse event:', eventData.type, `(${relativeX}, ${relativeY})`);
    }
    return true;
  } catch (error) {
    console.error('[DEBUG] Error sending mouse event:', error);
    log('❌ Error sending mouse event:', error);
    return false;
  }
}

// Input Capture Setup
function setupInputCapture() {
  if (!videoEl) return;

  videoEl.tabIndex = 0;
  videoEl.focus();
  console.log('[DEBUG] Video element focused for input capture');

  videoEl.addEventListener('contextmenu', (e) => e.preventDefault());
  
  videoEl.addEventListener('click', (e) => {
    videoEl.focus();
    console.log('[DEBUG] Video element focused on click');
  });

  videoEl.addEventListener('mousedown', (e) => {
    e.preventDefault();
    console.log('[DEBUG] Mouse down event:', e.clientX, e.clientY, 'button:', e.button);
    mouseState.capturing = true;
    sendMouseEvent({ 
      type: 'mousedown', 
      clientX: e.clientX, 
      clientY: e.clientY,
      button: e.button 
    });
  });

  videoEl.addEventListener('mouseup', (e) => {
    e.preventDefault();
    console.log('[DEBUG] Mouse up event:', e.clientX, e.clientY, 'button:', e.button);
    sendMouseEvent({ 
      type: 'mouseup', 
      clientX: e.clientX, 
      clientY: e.clientY,
      button: e.button 
    });
    mouseState.capturing = false;
  });

  videoEl.addEventListener('mousemove', (e) => {
    e.preventDefault();
    console.log('[DEBUG] Mouse move event:', e.clientX, e.clientY, 'capturing:', mouseState.capturing);
    sendMouseEvent({ 
      type: 'mousemove', 
      clientX: e.clientX, 
      clientY: e.clientY 
    });
  });

  videoEl.addEventListener('click', (e) => {
    e.preventDefault();
    sendMouseEvent({ 
      type: 'click', 
      clientX: e.clientX, 
      clientY: e.clientY,
      button: e.button 
    });
  });

  videoEl.addEventListener('wheel', (e) => {
    e.preventDefault();
    sendMouseEvent({ 
      type: 'wheel', 
      clientX: e.clientX, 
      clientY: e.clientY,
      deltaY: e.deltaY 
    });
  });

  document.addEventListener('keydown', (e) => {
    console.log('[DEBUG] Keydown event:', e.key, e.code, 'activeElement:', document.activeElement?.tagName);
    
    if (e.key === 'F11' || (e.ctrlKey && ['f', '1'].includes(e.key))) {
      console.log('[DEBUG] Allowing browser shortcut:', e.key);
      return;
    }

    if (videoEl && (document.activeElement === videoEl || document.activeElement === document.body)) {
      console.log('[DEBUG] Preventing default and sending keyboard event');
      e.preventDefault();
      sendKeyboardEvent(e);
    } else {
      console.log('[DEBUG] Not sending keyboard event - wrong focus');
    }
  });

  document.addEventListener('keyup', (e) => {
    console.log('[DEBUG] Keyup event:', e.key, e.code);
    
    if (videoEl && (document.activeElement === videoEl || document.activeElement === document.body)) {
      console.log('[DEBUG] Sending keyup event');
      e.preventDefault();
      sendKeyboardEvent(e);
    } else {
      console.log('[DEBUG] Not sending keyup event - wrong focus');
    }
  });

  log('✅ Direct input capture setup complete - bypassing service');
}

// Control Channel Functions
function launchRemoteApp(appName) {
  if (!controlChannel || controlChannel.readyState !== 'open') {
    showToast('Control channel not ready', 'error');
    return;
  }

  const appCommands = {
    powershell: 'powershell.exe',
    cmd: 'cmd.exe',
    notepad: 'notepad.exe',
    eventvwr: 'eventvwr.msc'
  };

  const appNames = {
    powershell: 'PowerShell',
    cmd: 'Command Prompt',
    notepad: 'Notepad',
    eventvwr: 'Event Viewer'
  };

  const command = appCommands[appName];
  if (!command) {
    showToast('Unknown application: ' + appName, 'error');
    return;
  }

  try {
    const message = JSON.stringify({
      type: 'launch_app',
      command: command,
      timestamp: Date.now()
    });

    controlChannel.send(message);
    showToast(`Launching ${appNames[appName] || appName}...`, 'info');
    log('📱 Sent app launch to Service via control channel:', command);
  } catch (error) {
    log('❌ Error sending app launch command:', error);
    showToast('Failed to launch application', 'error');
  }
}

function handleControlChannelMessage(message) {
  switch (message.type) {
    case 'app_launched':
      showToast(`Application launched: ${message.app}`, 'success');
      break;
    case 'app_launch_failed':
      showToast(`Failed to launch: ${message.app}`, 'error');
      break;
    case 'desktop_switched':
      showToast(`Switched to ${message.desktop} desktop`, 'info');
      break;
    case 'status':
      updateCounter(`Service: ${message.status}`);
      break;
    default:
      log('Unknown control message:', message);
  }
}

// Fullscreen functionality
function toggleFullscreen() {
  if (!isFullscreen) {
    enterFullscreen();
  } else {
    exitFullscreen();
  }
}

function enterFullscreen() {
  document.body.classList.add('fullscreen');
  isFullscreen = true;
  if (fullscreenBtn) {
    fullscreenBtn.classList.add('active');
  }
  
  if (fullscreenOverlay) {
    setTimeout(() => {
      fullscreenOverlay.classList.add('visible');
      setTimeout(() => {
        if (isFullscreen) fullscreenOverlay.classList.remove('visible');
      }, 3000);
    }, 100);
  }
}

function exitFullscreen() {
  document.body.classList.remove('fullscreen');
  if (fullscreenOverlay) {
    fullscreenOverlay.classList.remove('visible');
  }
  isFullscreen = false;
  if (fullscreenBtn) {
    fullscreenBtn.classList.remove('active');
  }
}

function fitToScreen() {
  videoEl.style.width = '100%';
  videoEl.style.height = '100%';
  videoEl.style.objectFit = 'contain';
  if (fitScreenBtn) {
    fitScreenBtn.classList.add('active');
  }
}

// Screenshot and Recording
function takeScreenshot() {
  if (!videoEl.videoWidth) return;
  
  const canvas = document.createElement('canvas');
  canvas.width = videoEl.videoWidth;
  canvas.height = videoEl.videoHeight;
  
  const ctx = canvas.getContext('2d');
  ctx.drawImage(videoEl, 0, 0);
  
  const link = document.createElement('a');
  link.download = `dell-remote-screenshot-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.png`;
  link.href = canvas.toDataURL();
  link.click();
  
  showToast('Screenshot saved successfully', 'success');
}

function toggleRecording() {
  if (!isRecording) {
    startRecording();
  } else {
    stopRecording();
  }
}

function startRecording() {
  if (!videoEl.srcObject) {
    showToast('No video stream available for recording', 'error');
    return;
  }

  try {
    recordedChunks = [];
    const stream = videoEl.srcObject;
    
    const options = {
      mimeType: 'video/webm;codecs=vp9,opus'
    };
    
    if (!MediaRecorder.isTypeSupported(options.mimeType)) {
      options.mimeType = 'video/webm;codecs=vp8,opus';
      if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        options.mimeType = 'video/webm';
      }
    }
    
    mediaRecorder = new MediaRecorder(stream, options);
    
    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        recordedChunks.push(event.data);
      }
    };
    
    mediaRecorder.onstop = () => {
      saveRecording();
    };
    
    mediaRecorder.start(1000);
    isRecording = true;
    
    if (recordBtn) {
      recordBtn.classList.add('recording');
      recordBtn.title = 'Stop Recording';
    }
    if (recordIcon) {
      recordIcon.innerHTML = '<rect x="6" y="6" width="4" height="4" rx="1"/>';
    }
    
    showToast('Recording started', 'success');
    log('Recording started');
    
  } catch (error) {
    log('Error starting recording:', error);
    showToast('Failed to start recording: ' + error.message, 'error');
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
  
  isRecording = false;
  
  if (recordBtn) {
    recordBtn.classList.remove('recording');
    recordBtn.title = 'Start Recording';
  }
  if (recordIcon) {
    recordIcon.innerHTML = '<circle cx="8" cy="8" r="3"/>';
  }
  
  showToast('Recording stopped', 'success');
  log('Recording stopped');
}

function saveRecording() {
  if (recordedChunks.length === 0) {
    showToast('No recording data to save', 'warning');
    return;
  }
  
  const blob = new Blob(recordedChunks, { type: 'video/webm' });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement('a');
  link.href = url;
  link.download = `dell-remote-recording-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.webm`;
  link.click();
  
  URL.revokeObjectURL(url);
  recordedChunks = [];
  
  showToast('Recording saved successfully', 'success');
  log('Recording saved');
}

// App launcher functionality
function setupAppLauncher() {
  if (!appsBtn || !appsDropdown) return;
  
  let isDropdownOpen = false;
  
  appsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    isDropdownOpen = !isDropdownOpen;
    appsDropdown.classList.toggle('show', isDropdownOpen);
  });
  
  document.addEventListener('click', () => {
    if (isDropdownOpen) {
      isDropdownOpen = false;
      appsDropdown.classList.remove('show');
    }
  });
  
  appsDropdown.addEventListener('click', (e) => {
    if (e.target.classList.contains('dell-app-item')) {
      const appName = e.target.dataset.app;
      launchRemoteApp(appName);
      isDropdownOpen = false;
      appsDropdown.classList.remove('show');
    }
  });
}

// Event listeners setup
function setupEventListeners() {
  if (fitScreenBtn) {
    fitScreenBtn.addEventListener('click', fitToScreen);
  }
  
  if (fullscreenBtn) {
    fullscreenBtn.addEventListener('click', toggleFullscreen);
  }
  
  if (exitFullscreenBtn) {
    exitFullscreenBtn.addEventListener('click', exitFullscreen);
  }
  
  if (screenshotBtn) {
    screenshotBtn.addEventListener('click', takeScreenshot);
  }
  
  if (recordBtn) {
    recordBtn.addEventListener('click', toggleRecording);
  }
  
  if (disconnectBtn) {
    disconnectBtn.addEventListener('click', () => {
      disconnect();
    });
  }

  document.addEventListener('keydown', (e) => {
    switch (e.key) {
      case 'F11':
        e.preventDefault();
        toggleFullscreen();
        break;
      case 'Escape':
        if (isFullscreen) {
          exitFullscreen();
        }
        break;
      case 'f':
        if (e.ctrlKey) {
          e.preventDefault();
          fitToScreen();
        }
        break;
    }
  });

  if (videoContainer) {
    videoContainer.addEventListener('mousemove', () => {
      if (isFullscreen && fullscreenOverlay) {
        fullscreenOverlay.classList.add('visible');
        clearTimeout(fullscreenOverlay.hideTimeout);
        fullscreenOverlay.hideTimeout = setTimeout(() => {
          fullscreenOverlay.classList.remove('visible');
        }, 3000);
      }
    });
  }
  
  if (tooltipTrigger && tooltipPanel) {
    let tooltipTimeout;
    
    tooltipTrigger.addEventListener('mouseenter', () => {
      clearTimeout(tooltipTimeout);
      tooltipPanel.classList.add('show');
    });
    
    tooltipTrigger.addEventListener('mouseleave', () => {
      tooltipTimeout = setTimeout(() => {
        tooltipPanel.classList.remove('show');
      }, 300);
    });
    
    tooltipPanel.addEventListener('mouseenter', () => {
      clearTimeout(tooltipTimeout);
    });
    
    tooltipPanel.addEventListener('mouseleave', () => {
      tooltipTimeout = setTimeout(() => {
        tooltipPanel.classList.remove('show');
      }, 300);
    });
  }
}

// WebRTC Signaling
function connectSignaling() {
  updateStatus("Connecting to signaling server...");
  if (loadingScreen) {
    loadingScreen.classList.remove('hidden');
  }
  
  socket = new WebSocket(SIGNALING_SERVER_URL);
  socket.binaryType = "arraybuffer";

  socket.onopen = () => {
    log("Connected to signaling server");
    updateStatus("Connected, registering…");
    socket.send(JSON.stringify({ deviceId: DEVICE_ID, authCode: AUTH_CODE }));
  };

  socket.onmessage = async (event) => {
    let data = event.data;
    if (data instanceof Blob) data = await data.text();
    if (data instanceof ArrayBuffer) data = new TextDecoder().decode(data);

    let msg;
    try { msg = JSON.parse(data); } catch {
      log("Invalid JSON from signaling: ", data);
      return;
    }

    log("Signal received:", msg.type);

    switch (msg.type) {
      case "paired":
        log("Paired with host, waiting for offer");
        updateStatus("Paired, waiting for screen data...");
        break;

      case "offer":
        await handleOffer(msg);
        break;

      case "candidate":
        if (pc && msg.candidate) {
          try {
            await pc.addIceCandidate(msg.candidate);
            log("ICE candidate added:", msg.candidate.candidate?.substring(0, 50) + "...");
          } catch (e) {
            log("ICE candidate error:", e);
          }
        }
        break;

      case "partner-disconnected":
        log("Partner disconnected");
        updateStatus("Host disconnected");
        showToast('Remote host disconnected', 'warning');
        teardown();
        break;

      case "error":
        log("Signaling error:", msg.message || msg);
        updateStatus("Error: " + (msg.message || "unknown"));
        showToast('Connection error: ' + (msg.message || "unknown"), 'error');
        teardown();
        break;

      default:
        log("Unknown message type", msg.type);
    }
  };

  socket.onclose = () => {
    log("Signaling connection closed");
    updateStatus("Signaling disconnected");
    showToast('Connection lost, reconnecting...', 'warning');
    setTimeout(connectSignaling, 3000);
  };

  socket.onerror = (e) => {
    log("WebSocket error:", e);
    updateStatus("Connection failed");
    showToast('Connection failed', 'error');
  };
}

async function handleOffer(msg) {
  log("Received offer");
  updateStatus("Receiving media...");

  if (pc) teardown();

  pc = new RTCPeerConnection(rtcConfig);
  const remoteStream = new MediaStream();
  videoEl.srcObject = remoteStream;

  pc.ontrack = e => {
    log("Track received:", e.track.kind);
    remoteStream.addTrack(e.track);
    updateStatus("Streaming started", true);
    updateQuality("HD Quality • Active");
    fitToScreen();
    
    setupInputCapture();
  };

  pc.onicecandidate = e => {
    if (e.candidate) {
      socket.send(JSON.stringify({ type: "candidate", candidate: e.candidate }));
      log("Sent ICE candidate:", e.candidate.candidate?.substring(0, 50) + "...");
    }
  };

  pc.oniceconnectionstatechange = () => {
    log("ICE state:", pc.iceConnectionState);
    
    if (pc.iceConnectionState === 'connected') {
      updateStatus("Connected and streaming", true);
      updateQuality("HD Quality • Connected");
    } else if (['disconnected', 'failed', 'closed'].includes(pc.iceConnectionState)) {
      updateStatus("Connection lost - " + pc.iceConnectionState);
      updateQuality("Connection issues...");
      if (pc.iceConnectionState === 'failed') {
        log("ICE connection failed - NAT/firewall issues");
        showToast('Connection failed - check network settings', 'error');
      }
    }
  };

  pc.onconnectionstatechange = () => {
    log("Connection state:", pc.connectionState);
  };

  pc.ondatachannel = event => {
    const channel = event.channel;
    log(`🔗 DataChannel received: ${channel.label}`);
    
    switch (channel.label) {
      case 'control':
        controlChannel = channel;
        setupControlChannel(channel);
        updateChannelStatus('control', true);
        break;
        
      case 'input':
        inputChannel = channel;
        setupInputChannel(channel);
        updateChannelStatus('input', true);
        break;
        
      case 'mouse':
        mouseChannel = channel;
        setupMouseChannel(channel);
        updateChannelStatus('mouse', true);
        break;
        
      case 'screen-share':
        controlChannel = channel;
        setupControlChannel(channel);
        updateChannelStatus('control', true);
        break;

      default:
        log(`Unknown channel: ${channel.label}`);
        break;
    }
  };

  try {
    await pc.setRemoteDescription(new RTCSessionDescription({ type: "offer", sdp: msg.sdp }));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    log("Sending answer");
    socket.send(JSON.stringify({ type: "answer", sdp: answer.sdp }));
  } catch (error) {
    log("Error handling offer:", error);
    updateStatus("Error: " + error.message);
    updateQuality("Connection failed");
    showToast('Failed to establish connection', 'error');
  }
}

function setupControlChannel(channel) {
  channel.onopen = () => {
    log('🎛️ Control channel opened - app launcher ready');
    if (appsBtn) {
      appsBtn.disabled = false;
    }
    showToast('App launcher ready', 'success');
  };
  
  channel.onclose = () => {
    log('Control channel closed');
    updateChannelStatus('control', false);
    if (appsBtn) {
      appsBtn.disabled = true;
    }
    controlChannel = null;
  };
  
  channel.onerror = (error) => {
    log('Control channel error:', error);
  };
  
  channel.onmessage = e => {
    try {
      const message = JSON.parse(e.data);
      handleControlChannelMessage(message);
    } catch (ex) {
      log('Non-JSON control message:', e.data);
    }
  };
}

function setupInputChannel(channel) {
  channel.onopen = () => {
    log('⌨️ Input channel opened - direct keyboard ready');
    showToast('Direct keyboard input ready', 'success');
  };
  
  channel.onclose = () => {
    log('Input channel closed');
    updateChannelStatus('input', false);
    inputChannel = null;
  };
  
  channel.onerror = (error) => {
    log('Input channel error:', error);
  };
  
  channel.onmessage = e => {
    log('Input channel feedback:', e.data);
  };
}

function setupMouseChannel(channel) {
  channel.onopen = () => {
    log('🖱️ Mouse channel opened - direct mouse ready');
    showToast('Direct mouse input ready', 'success');
  };
  
  channel.onclose = () => {
    log('Mouse channel closed');
    updateChannelStatus('mouse', false);
    mouseChannel = null;
  };
  
  channel.onerror = (error) => {
    log('Mouse channel error:', error);
  };
  
  channel.onmessage = e => {
    log('Mouse channel feedback:', e.data);
  };
}

async function disconnect() {
  log("User initiated disconnect");
  showToast('Disconnecting...', 'warning');
  
  // Call WDA Service disconnect API
  await disconnectRemoteService();
  
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'disconnect', deviceId: DEVICE_ID }));
  }
  
  teardown();
  
  if (socket) {
    socket.close();
    socket = null;
  }
  
  updateStatus("Disconnected", false);
  showToast('Successfully disconnected', 'success');
}

function teardown() {
  if (pc) {
    pc.getSenders().forEach(s => s.track?.stop());
    pc.close();
    pc = null;
  }
  
  controlChannel = null;
  inputChannel = null;
  mouseChannel = null;
  
  updateChannelStatus('control', false);
  updateChannelStatus('input', false);
  updateChannelStatus('mouse', false);
  
  videoEl.srcObject = null;
  mouseState.capturing = false;
  
  updateCounter("Disconnected");
  updateQuality("Not connected");
  
  if (screenshotBtn) {
    screenshotBtn.disabled = true;
  }
  if (appsBtn) {
    appsBtn.disabled = true;
  }
  if (loadingScreen) {
    loadingScreen.classList.remove('hidden');
  }
}

window.addEventListener('beforeunload', teardown);

// Initialize everything when DOM is loaded
async function initialize() {
  log('🚀 Dell Remote Desktop initializing...');
  
  // Prompt for device IP first
  const deviceIP = await promptForDeviceIP();
  
  if (!deviceIP) {
    log('❌ No device IP provided, cannot continue');
    showToast('Device IP required to continue', 'error');
    return;
  }
  
  log(`✅ Device IP configured: ${deviceIP}`);
  
  // Call connect API
  const connected = await connectRemoteService();
  
  if (!connected) {
    log('⚠️ Failed to connect to remote service, continuing anyway...');
  }
  
  // Continue with normal initialization
  setupEventListeners();
  setupAppLauncher();
  connectSignaling();
  
  // Connection quality monitoring
  setInterval(() => {
    if (pc && pc.iceConnectionState === 'connected') {
      pc.getStats().then(stats => {
        updateQuality("HD Quality • Active");
      });
    }
  }, 5000);
  
  log('🚀 Dell Remote Desktop initialized with multi-channel architecture');
  log('📋 Channels: Control→Service, Input→UnifiedCaptureHelper, Mouse→UnifiedCaptureHelper');
  log('🔌 WDA Service integration enabled');
}

// Start when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  initialize();
}
