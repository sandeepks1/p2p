// Dell Remote Desktop - Multi-Channel WebRTC Client
// Direct Input Architecture: Keyboard/Mouse → UnifiedCaptureHelper, Control → Service

const SIGNALING_SERVER_URL = "wss://signalling-server-oxaw.onrender.com/ws";
const DEVICE_ID = "device001";
const AUTH_CODE = "secret";

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
let controlChannel = null;    // For app launching, control commands (Service)
let inputChannel = null;      // For keyboard events (Direct to UnifiedCaptureHelper)
let mouseChannel = null;      // For mouse events (Direct to UnifiedCaptureHelper)
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

// MessagePack encoding for ultra-fast input transmission
function msgpackEncode(obj) {
  return JSON.stringify(obj); // Simplified for now, can add real MessagePack later
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
  console.log('[DEBUG] sendKeyboardEvent called with:', eventData);
  
  if (!inputChannel) {
    console.log('[DEBUG] Input channel is null');
    log('⚠️ Input channel not available for keyboard event');
    return false;
  }
  
  if (inputChannel.readyState !== 'open') {
    console.log('[DEBUG] Input channel state:', inputChannel.readyState);
    log('⚠️ Input channel not ready for keyboard event, state:', inputChannel.readyState);
    return false;
  }

  try {
    const message = msgpackEncode({
      type: eventData.type,  // 'keydown' or 'keyup'
      key: eventData.key,
      code: eventData.code,
      ctrlKey: eventData.ctrlKey,
      altKey: eventData.altKey,
      shiftKey: eventData.shiftKey,
      timestamp: Date.now()
    });

    console.log('[DEBUG] Sending keyboard message:', message);
    inputChannel.send(message);
    console.log('[DEBUG] Keyboard message sent successfully');
    log('🎹 Sent keyboard event:', eventData.type, eventData.key);
    return true;
  } catch (error) {
    console.error('[DEBUG] Error sending keyboard event:', error);
    log('❌ Error sending keyboard event:', error);
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
    const relativeX = Math.round(eventData.clientX - rect.left);
    const relativeY = Math.round(eventData.clientY - rect.top);
    
    const message = msgpackEncode({
      type: eventData.type,
      x: relativeX,
      y: relativeY,
      button: eventData.button || 0,
      deltaY: eventData.deltaY || 0,
      timestamp: Date.now()
    });

    console.log('[DEBUG] Sending mouse message:', message);
    mouseChannel.send(message);
    console.log('[DEBUG] Mouse message sent successfully');
    
    // Only log occasionally to avoid spam
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

  // Make video focusable and focus it
  videoEl.tabIndex = 0;
  videoEl.focus();
  console.log('[DEBUG] Video element focused for input capture');

  // Prevent context menu
  videoEl.addEventListener('contextmenu', (e) => e.preventDefault());
  
  // Focus video on click
  videoEl.addEventListener('click', (e) => {
    videoEl.focus();
    console.log('[DEBUG] Video element focused on click');
  });

  // Mouse events - Direct to UnifiedCaptureHelper
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
    // Send all mouse moves, not just when capturing
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

  // Keyboard events - Direct to UnifiedCaptureHelper  
  document.addEventListener('keydown', (e) => {
    console.log('[DEBUG] Keydown event:', e.key, e.code, 'activeElement:', document.activeElement?.tagName);
    
    // Allow some browser shortcuts
    if (e.key === 'F11' || (e.ctrlKey && ['f', '1'].includes(e.key))) {
      console.log('[DEBUG] Allowing browser shortcut:', e.key);
      return; // Handle locally
    }

    // Send ALL keyboard events when video is focused or visible
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

// Control Channel Functions (for Service communication)
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

// Screenshot and Recording (unchanged)
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

  // Keyboard shortcuts (global)
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

  // Mouse events for fullscreen overlay
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
  
  // Tooltip functionality
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
    
    // Setup input capture after video is ready
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

  // Handle multiple incoming DataChannels from server
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
  
  // Input channel is outbound only
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
  
  // Mouse channel is outbound only
  channel.onmessage = e => {
    log('Mouse channel feedback:', e.data);
  };
}

function disconnect() {
  log("User initiated disconnect");
  showToast('Disconnecting...', 'warning');
  
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
  
  // Clear all channel references
  controlChannel = null;
  inputChannel = null;
  mouseChannel = null;
  
  // Update channel indicators
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
function initialize() {
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
}

// Start when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  initialize();
}
