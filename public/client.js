const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const flowerOverlay = document.getElementById('flowerOverlay');
const chat = document.getElementById('chat');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const startChatBtn = document.getElementById('startChatBtn');
const nextBtn = document.getElementById('nextBtn');
const searchingMessageElement = document.getElementById('searchingMessage');

const ws = new WebSocket(`wss://${window.location.host}`);

let peerConnection;
let localStream = null;
let isCaller = false;
let nsfwModel;
let isChatting = false;

const config = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'turn:turn.anyfirewall.com:443', username: 'webrtc', credential: 'webrtc' }
    ]
};

// Load NSFW model
nsfwjs.load().then(model => {
    nsfwModel = model;
    console.log("✅ [Client] NSFWJS model loaded.");
}).catch(err => {
    console.error("❌ [Client] Failed to load NSFWJS model:", err);
    alert("Failed to load NSFW detection model.");
});

async function startCamera() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localStream = stream;
        localVideo.srcObject = stream;
        detectNSFW();
        console.log("📹 [Client] Local camera started.");
        return stream;
    } catch (error) {
        console.error('❗ [Client] Error accessing media devices:', error);
        alert("Please grant camera and mic permissions.");
        startChatBtn.disabled = false;
        throw error;
    }
}

function showSearchingAnimation() {
    searchingMessageElement.innerHTML = '<div class="loader"></div> Searching for a stranger...';
    searchingMessageElement.style.display = 'block';
}

function hideSearchingAnimation() {
    searchingMessageElement.style.display = 'none';
    searchingMessageElement.innerHTML = '';
}

startChatBtn.onclick = async () => {
    if (!localStream) {
        try {
            await startCamera();
            if (localStream) {
                ws.send(JSON.stringify({ type: 'start_chat' }));
                startChatBtn.disabled = true;
                nextBtn.disabled = true;
                showSearchingAnimation();
            }
        } catch (error) {
            console.error("❌ [Client] Failed to start camera:", error);
        }
    } else if (!isChatting) {
        ws.send(JSON.stringify({ type: 'start_chat' }));
        startChatBtn.disabled = true;
        nextBtn.disabled = true;
        showSearchingAnimation();
    } else {
        alert("You're already in a chat.");
    }
};

nextBtn.onclick = () => {
    if (isChatting) {
        cleanupConnection();
        ws.send(JSON.stringify({ type: 'next' }));
        startChatBtn.disabled = true;
        nextBtn.disabled = true;
        showSearchingAnimation();
        isChatting = false;
    } else {
        alert("Click 'Start Chat' to begin.");
    }
};

ws.onmessage = async (event) => {
    let rawData = event.data;
    if (rawData instanceof Blob) rawData = await rawData.text();
    const data = JSON.parse(rawData);

    console.log("👂 [Client] Received message:", data);

    switch (data.type) {
        case 'match':
            isCaller = true;
            isChatting = true;
            startPeerConnection();
            createAndSendOffer();
            startChatBtn.disabled = true;
            nextBtn.disabled = false;
            hideSearchingAnimation();
            break;

        case 'offer':
            isCaller = false;
            isChatting = true;
            startPeerConnection();
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            ws.send(JSON.stringify({ type: 'answer', answer: peerConnection.localDescription }));
            startChatBtn.disabled = true;
            nextBtn.disabled = false;
            hideSearchingAnimation();
            break;

        case 'answer':
            if (peerConnection && peerConnection.signalingState === 'have-local-offer') {
                await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
            }
            break;

        case 'candidate':
            if (data.candidate && peerConnection) {
                try {
                    console.log('📥 ICE candidate received:', data.candidate);
                    await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
                } catch (e) {
                    console.error('❗ Error adding ICE candidate:', e);
                }
            }
            break;

        case 'text':
            addChatMessage(`Stranger: ${data.text}`);
            break;

        case 'partner_left':
            addChatMessage('Stranger left the chat.');
            cleanupConnection();
            alert("Stranger left. Click 'Next' to continue.");
            startChatBtn.disabled = false;
            nextBtn.disabled = true;
            isChatting = false;
            break;

        case 'no_partners':
            alert("No partners available. Try again later.");
            startChatBtn.disabled = false;
            nextBtn.disabled = true;
            hideSearchingAnimation();
            break;

        case 'waiting':
            searchingMessageElement.innerHTML = '<div class="loader"></div> Waiting for a partner...';
            searchingMessageElement.style.display = 'block';
            break;
    }
};

function startPeerConnection() {
    if (peerConnection) return;
    peerConnection = new RTCPeerConnection(config);

    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
        console.log(`➕ Added local track: ${track.kind}`);
    });

    peerConnection.addEventListener('track', (event) => {
        console.log('🎥 Remote track received:', event.track.kind);
        if (event.streams.length > 0) {
            remoteVideo.srcObject = event.streams[0];
            console.log('✅ Remote video stream set.');
        } else {
            console.warn('⚠️ No stream in track event.');
        }
    });

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            console.log('📤 ICE candidate sent:', event.candidate);
            ws.send(JSON.stringify({ type: 'candidate', candidate: event.candidate }));
        }
    };

    peerConnection.oniceconnectionstatechange = () => {
        console.log("🧊 ICE Connection State:", peerConnection.iceConnectionState);
        if (['disconnected', 'failed', 'closed'].includes(peerConnection.iceConnectionState)) {
            addChatMessage('Connection with stranger lost.');
            cleanupConnection();
            alert("Connection lost. Click 'Next' to continue.");
            startChatBtn.disabled = false;
            nextBtn.disabled = true;
            isChatting = false;
        }
    };
}

async function createAndSendOffer() {
    try {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        ws.send(JSON.stringify({ type: 'offer', offer: peerConnection.localDescription }));
        console.log("📤 Sent offer to stranger.");
    } catch (error) {
        console.error('❗ Error creating offer:', error);
        alert("Failed to start chat. Try again.");
    }
}

sendBtn.onclick = () => {
    const text = messageInput.value.trim();
    if (text && isChatting) {
        addChatMessage(`You: ${text}`);
        ws.send(JSON.stringify({ type: 'text', text }));
        messageInput.value = '';
    } else if (!isChatting) {
        alert("Connect to a stranger first.");
    }
};

messageInput.addEventListener('keypress', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
        sendBtn.click();
        event.preventDefault();
    }
});

function addChatMessage(message) {
    const div = document.createElement('div');
    div.textContent = message;
    chat.appendChild(div);
    chat.scrollTop = chat.scrollHeight;
}

function cleanupConnection() {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    if (remoteVideo.srcObject) {
        remoteVideo.srcObject.getTracks().forEach(track => track.stop());
        remoteVideo.srcObject = null;
    }
}

function detectNSFW() {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    function analyzeFrame() {
        if (!localStream || !nsfwModel || localVideo.videoWidth === 0) {
            setTimeout(analyzeFrame, 1000);
            return;
        }

        canvas.width = localVideo.videoWidth;
        canvas.height = localVideo.videoHeight;
        ctx.drawImage(localVideo, 0, 0, canvas.width, canvas.height);

        nsfwModel.classify(canvas).then(predictions => {
            const result = predictions[0];
            const shouldHide = ['Porn', 'Hentai', 'Sexy'].includes(result.className) && result.probability > 0.7;
            flowerOverlay.style.display = shouldHide ? 'block' : 'none';

            if (shouldHide) {
                console.warn("⚠️ NSFW content detected!");
            }
        }).catch(() => {
            flowerOverlay.style.display = 'none';
        });

        setTimeout(analyzeFrame, 1000);
    }

    analyzeFrame();
}

startCamera().catch(() => {});

ws.onopen = () => {
    console.log("✅ WebSocket connected.");
    startChatBtn.disabled = false;
    nextBtn.disabled = true;
    hideSearchingAnimation();
};

ws.onclose = () => {
    console.log("❌ WebSocket disconnected.");
    startChatBtn.disabled = true;
    nextBtn.disabled = true;
    showSearchingAnimation();
    searchingMessageElement.innerHTML = "Connection lost. Refresh the page.";
};

ws.onerror = (error) => {
    console.error("❗ WebSocket error:", error);
    alert("WebSocket connection error.");
    showSearchingAnimation();
    searchingMessageElement.innerHTML = "WebSocket error. Please refresh.";
};
