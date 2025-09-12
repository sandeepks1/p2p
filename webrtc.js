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

// Optional buttons (may not exist in minimal header)
const actualSizeBtn = document.getElementById("actualSizeBtn");
const reconnectBtn = document.getElementById("reconnectBtn");
const screenshotBtn = document.getElementById("screenshotBtn");
const settingsBtn = document.getElementById("settingsBtn");
const aboutBtn = document.getElementById("aboutBtn");

let socket, pc;
let isFullscreen = false;
let connectionStats = { bitrate: 0, latency: 0 };

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
  counterDisplay.textContent = text;
  counterDisplay.classList.add('visible');
}

function updateQuality(info) {
  qualityInfo.textContent = info;
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
