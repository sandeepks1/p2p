// CHANGE THIS TO THE ACTUAL SIGNALING SERVER IP
const SIGNALING_SERVER_URL = "wss://signalling-server-oxaw.onrender.com/ws";
const DEVICE_ID = "device001";
const AUTH_CODE = "secret";

// Enhanced ICE server configuration for cross-network connectivity
const rtcConfig = {
   iceServers: [
  {
    urls: "stun:stun.relay.metered.ca:80",
  },
  // {
  //   urls: "turn:global.relay.metered.ca:80",
  //   username: "6d53bf5674ee887bb0119be8",
  //   credential: "yJMy/8xpXCBqwy6a",
  // },
  // {
  //   urls: "turn:global.relay.metered.ca:80?transport=tcp",
  //   username: "6d53bf5674ee887bb0119be8",
  //   credential: "yJMy/8xpXCBqwy6a",
  // },
  // {
  //   urls: "turn:global.relay.metered.ca:443",
  //   username: "6d53bf5674ee887bb0119be8",
  //   credential: "yJMy/8xpXCBqwy6a",
  // },
  // {
  //   urls: "turns:global.relay.metered.ca:443?transport=tcp",
  //   username: "6d53bf5674ee887bb0119be8",
  //   credential: "yJMy/8xpXCBqwy6a",
  // },
],
  iceCandidatePoolSize: 10,
  iceTransportPolicy: 'all'  // Allow both STUN and TURN candidates
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

// Toolbar buttons (only the ones that exist in the minimal header)
const fitScreenBtn = document.getElementById("fitScreenBtn");
const fullscreenBtn = document.getElementById("fullscreenBtn");
const exitFullscreenBtn = document.getElementById("exitFullscreenBtn");
const disconnectBtn = document.getElementById("disconnectBtn");

// New controls
const screenshotBtn = document.getElementById("screenshotBtn");
const recordBtn = document.getElementById("recordBtn");
const recordIcon = document.getElementById("recordIcon");
const appsBtn = document.getElementById("appsBtn");
const appsDropdown = document.getElementById("appsDropdown");

// Tooltip elements
const tooltipTrigger = document.getElementById("tooltipTrigger");
const tooltipPanel = document.getElementById("tooltipPanel");

// Optional buttons (may not exist in minimal header)
const actualSizeBtn = document.getElementById("actualSizeBtn");
const reconnectBtn = document.getElementById("reconnectBtn");
const settingsBtn = document.getElementById("settingsBtn");
const aboutBtn = document.getElementById("aboutBtn");

let socket, pc, dataChannel;
let isFullscreen = false;
let connectionStats = { bitrate: 0, latency: 0 };

// Recording variables
let mediaRecorder = null;
let recordedChunks = [];
let isRecording = false;

function log(...args) { console.log("[Dell Remote Desktop]", ...args); }

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
  
  // Show fullscreen overlay briefly
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

// Video scaling functions
function fitToScreen() {
  videoEl.style.width = '100%';
  videoEl.style.height = '100%';
  videoEl.style.objectFit = 'contain';
  if (fitScreenBtn) {
    fitScreenBtn.classList.add('active');
  }
  if (actualSizeBtn) {
    actualSizeBtn.classList.remove('active');
  }
}

function actualSize() {
  videoEl.style.width = 'auto';
  videoEl.style.height = 'auto';
  videoEl.style.objectFit = 'none';
  if (actualSizeBtn) {
    actualSizeBtn.classList.add('active');
  }
  if (fitScreenBtn) {
    fitScreenBtn.classList.remove('active');
  }
}

// Screenshot functionality
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

// Screen recording functionality
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
    
    // Create MediaRecorder with optimal settings
    const options = {
      mimeType: 'video/webm;codecs=vp9,opus'
    };
    
    // Fallback MIME types if VP9 is not supported
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
    
    mediaRecorder.start(1000); // Collect data every second
    isRecording = true;
    
    // Update UI
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
  
  // Update UI
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
  
  // Clean up
  URL.revokeObjectURL(url);
  recordedChunks = [];
  
  showToast('Recording saved successfully', 'success');
  log('Recording saved');
}

// App launcher functionality
function setupAppLauncher() {
  if (!appsBtn || !appsDropdown) return;
  
  let isDropdownOpen = false;
  
  // Toggle dropdown
  appsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    isDropdownOpen = !isDropdownOpen;
    appsDropdown.classList.toggle('show', isDropdownOpen);
  });
  
  // Close dropdown when clicking outside
  document.addEventListener('click', () => {
    if (isDropdownOpen) {
      isDropdownOpen = false;
      appsDropdown.classList.remove('show');
    }
  });
  
  // Handle app selection
  appsDropdown.addEventListener('click', (e) => {
    if (e.target.classList.contains('dell-app-item')) {
      const appName = e.target.dataset.app;
      launchRemoteApp(appName);
      isDropdownOpen = false;
      appsDropdown.classList.remove('show');
    }
  });
}

function launchRemoteApp(appName) {
  if (!dataChannel || dataChannel.readyState !== 'open') {
    showToast('Data channel not available for remote commands', 'error');
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
    
    // Send the JSON message
    dataChannel.send(message);
    
    // Also send the simple format message
    const simpleMessage = `openapplication-${appNames[appName] || appName}`;
    dataChannel.send(simpleMessage);
    
    showToast(`Launching ${appNames[appName] || appName}...`, 'info');
    log('Sent app launch command:', command);
    log('Sent simple message:', simpleMessage);
    
  } catch (error) {
    log('Error sending app launch command:', error);
    showToast('Failed to launch application', 'error');
  }
}

// Data channel setup for remote commands
function setupDataChannel() {
  if (!pc) return;
  
  try {
    dataChannel = pc.createDataChannel('commands', {
      ordered: true
    });
    
    dataChannel.onopen = () => {
      log('Data channel opened - remote commands available');
      if (appsBtn) {
        appsBtn.disabled = false;
      }
    };
    
    dataChannel.onclose = () => {
      log('Data channel closed');
      if (appsBtn) {
        appsBtn.disabled = true;
      }
    };
    
    dataChannel.onerror = (error) => {
      log('Data channel error:', error);
    };
    
    dataChannel.onmessage = (event) => {
      log('Data channel message received:', event.data);
      try {
        const message = JSON.parse(event.data);
        handleDataChannelMessage(message);
      } catch (e) {
        log('Non-JSON data channel message:', event.data);
      }
    };
    
  } catch (error) {
    log('Error setting up data channel:', error);
  }
}

function handleDataChannelMessage(message) {
  switch (message.type) {
    case 'app_launched':
      showToast(`Application launched: ${message.app}`, 'success');
      break;
    case 'app_launch_failed':
      showToast(`Failed to launch: ${message.app}`, 'error');
      break;
    case 'status':
      updateCounter(`Remote: ${message.status}`);
      break;
    default:
      log('Unknown data channel message:', message);
  }
}

// Event listeners setup function
function setupEventListeners() {
  // Only bind event listeners for buttons that exist
  if (fitScreenBtn) {
    fitScreenBtn.addEventListener('click', fitToScreen);
  }
  
  if (fullscreenBtn) {
    fullscreenBtn.addEventListener('click', toggleFullscreen);
  }
  
  if (actualSizeBtn) {
    actualSizeBtn.addEventListener('click', actualSize);
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
  
  if (reconnectBtn) {
    reconnectBtn.addEventListener('click', () => {
      showToast('Reconnecting...', 'warning');
      teardown();
      connectSignaling();
    });
  }
  
  if (disconnectBtn) {
    disconnectBtn.addEventListener('click', () => {
      disconnect();
    });
  }

  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
      showToast('Settings panel coming soon!', 'info');
    });
  }

  if (aboutBtn) {
    aboutBtn.addEventListener('click', () => {
      showToast('Dell Remote Desktop v1.0 - Powered by WebRTC', 'info');
    });
  }

  // Keyboard shortcuts
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
      case '1':
        if (e.ctrlKey) {
          e.preventDefault();
          actualSize();
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
    
    // Show tooltip on mouse enter
    tooltipTrigger.addEventListener('mouseenter', () => {
      clearTimeout(tooltipTimeout);
      tooltipPanel.classList.add('show');
    });
    
    // Hide tooltip on mouse leave with delay
    tooltipTrigger.addEventListener('mouseleave', () => {
      tooltipTimeout = setTimeout(() => {
        tooltipPanel.classList.remove('show');
      }, 300); // Small delay to allow moving to tooltip
    });
    
    // Keep tooltip open when hovering over it
    tooltipPanel.addEventListener('mouseenter', () => {
      clearTimeout(tooltipTimeout);
    });
    
    // Hide tooltip when leaving the panel
    tooltipPanel.addEventListener('mouseleave', () => {
      tooltipTimeout = setTimeout(() => {
        tooltipPanel.classList.remove('show');
      }, 300);
    });
  }
}

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
    // FIXED: Use the same protocol as client.js
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
    // Auto-reconnect after 3 seconds
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

  // FIXED: Use same ICE configuration as client
  pc = new RTCPeerConnection(rtcConfig);
  const remoteStream = new MediaStream();
  videoEl.srcObject = remoteStream;

  pc.ontrack = e => {
    log("Track received:", e.track.kind);
    remoteStream.addTrack(e.track);
    updateStatus("Streaming started", true);
    updateQuality("HD Quality • Active");
    fitToScreen(); // Default to fit screen
    
    // Setup data channel for remote commands
    setupDataChannel();
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
        log("ICE connection failed - this usually indicates NAT/firewall issues");
        showToast('Connection failed - check network settings', 'error');
      }
    }
  };

  pc.onconnectionstatechange = () => {
    log("Connection state:", pc.connectionState);
  };

  // Handle incoming DataChannel
  pc.ondatachannel = event => {
    const channel = event.channel;
    log("DataChannel received:", channel.label);

    channel.onopen = () => {
      log("DataChannel opened:", channel.label);
    };
    channel.onmessage = e => {
      log("DataChannel message:", e.data);
      updateCounter(`Data: ${e.data}`);
    };
    channel.onclose = () => {
      log("DataChannel closed");
      updateCounter("Data channel closed");
    };
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

// Disconnect function - cleanly disconnect and notify signaling server
function disconnect() {
  log("User initiated disconnect");
  showToast('Disconnecting...', 'warning');
  
  // Send disconnect message to signaling server to clear the room
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'disconnect', deviceId: DEVICE_ID }));
  }
  
  // Perform local cleanup
  teardown();
  
  // Close signaling connection
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
  videoEl.srcObject = null;
  updateCounter("Disconnected");
  updateQuality("Not connected");
  if (screenshotBtn) {
    screenshotBtn.disabled = true;
  }
  if (loadingScreen) {
    loadingScreen.classList.remove('hidden');
  }
}

// Enhanced error handling and connection monitoring
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
        // Update connection statistics
        updateQuality("HD Quality • Active");
      });
    }
  }, 5000);
}

// Start when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  initialize();
}
