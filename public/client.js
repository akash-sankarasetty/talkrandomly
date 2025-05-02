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
let localStream;
let isCaller = false;
let nsfwModel;
let isChatting = false;

const config = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

// Load NSFW model
nsfwjs.load().then(model => {
    nsfwModel = model;
    console.log("✅ [Client] NSFWJS model loaded.");
}).catch(err => {
    console.error("❌ [Client] Failed to load NSFWJS model:", err);
    alert("Failed to load NSFW detection model.  The app may not function correctly."); // Inform the user
});

// Start local camera
function startCamera() {
    return navigator.mediaDevices.getUserMedia({ video: true, audio: true }) // Return the promise
        .then(stream => {
            localStream = stream;
            localVideo.srcObject = stream;
            detectNSFW();
            return stream; // Return the stream
        })
        .catch(error => {
            console.error('❗ [Client] Error accessing media devices:', error);
            alert("Please grant camera and microphone permissions to use this application.");
            startChatBtn.disabled = false; //Re-enable start chat
            throw error; // Re-throw the error to prevent further execution
        });
}

function showSearchingAnimation() {
    searchingMessageElement.innerHTML = '<div class="loader"></div> Searching for a stranger...';
    searchingMessageElement.style.display = 'block';
}

function hideSearchingAnimation() {
    searchingMessageElement.style.display = 'none';
    searchingMessageElement.innerHTML = ''; // Clear the content
}

startChatBtn.onclick = () => {
    if (!localStream) {
        startCamera().then(() => { //chain
            ws.send(JSON.stringify({ type: 'start_chat' }));
            console.log("🔄 [Client] Sent 'start_chat'");
            startChatBtn.disabled = true;
            nextBtn.disabled = true;
            showSearchingAnimation();
        }).catch(()=>{});
    } else if (!isChatting) {
        ws.send(JSON.stringify({ type: 'start_chat' }));
        console.log("🔄 [Client] Sent 'start_chat'");
        startChatBtn.disabled = true;
        nextBtn.disabled = true;
        showSearchingAnimation();
    } else {
        alert("You are already in a chat. Click 'Next' to find a new partner.");
    }
};

nextBtn.onclick = () => {
    if (isChatting) {
        console.log("➡️ [Client] 'Next' button clicked.");
        cleanupConnection();
        ws.send(JSON.stringify({ type: 'next' }));
        console.log("🔄 [Client] Sent 'next'");
        startChatBtn.disabled = true;
        nextBtn.disabled = true;
        showSearchingAnimation();
        isChatting = false;
    } else {
        alert("Click 'Start Chat' to find a partner first.");
    }
};

ws.onmessage = async (event) => {
    let rawData = event.data;
    if (rawData instanceof Blob) rawData = await rawData.text();
    const data = JSON.parse(rawData);

    console.log("👂 [Client] Received message:", data);

    if (data.type === 'match') {
        console.log("✅ [Client] Matched with a stranger!");
        isCaller = true;
        isChatting = true;
        startPeerConnection();
        createAndSendOffer();
        startChatBtn.disabled = true;
        nextBtn.disabled = false;
        hideSearchingAnimation();
    } else if (data.type === 'offer') {
        console.log("🤝 [Client] Received offer from stranger.");
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
    } else if (data.type === 'answer') {
        console.log("👍 [Client] Received answer from stranger.");
        if (peerConnection && peerConnection.signalingState === 'have-local-offer') {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
        }
    } else if (data.type === 'candidate') {
        if (data.candidate && peerConnection) {
            try {
                await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
            } catch (e) {
                console.error('❗ [Client] Error adding ICE candidate:', e);
            }
        }
    } else if (data.type === 'text') {
        addChatMessage(`Stranger: ${data.text}`);
    } else if (data.type === 'partner_left') {
        console.log("💔 [Client] Partner left the chat.");
        addChatMessage('Stranger left the chat.');
        cleanupConnection();
        alert("The stranger has left. Click 'Next' to find a new match.");
        startChatBtn.disabled = false;
        nextBtn.disabled = true;
        isChatting = false;
    } else if (data.type === 'no_partners') {
        console.log("ℹ️ [Client] No partners available.");
        alert("No other users are currently available. Please try again later.");
        startChatBtn.disabled = false;
        nextBtn.disabled = true;
        hideSearchingAnimation();
    } else if (data.type === 'waiting') {
        console.log("⏳ [Client] Received 'waiting' message.");
        searchingMessageElement.innerHTML = '<div class="loader"></div> Waiting for a partner...';
        searchingMessageElement.style.display = 'block';
    }
};

function startPeerConnection() {
    if (peerConnection) return;

    peerConnection = new RTCPeerConnection(config);

    // Add all local tracks
    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });

    // Use addEventListener for track event
    peerConnection.addEventListener('track', event => {
        console.log("🎥 [Client] Received remote track via addEventListener:", event.track.kind);
        console.log("  [Client] Event:", event); // Log the entire event object

        if (event.streams && event.streams.length > 0) {
            const remoteStream = event.streams[0];
            console.log("  [Client] Remote stream ID:", remoteStream.id);
            console.log("  [Client] Remote stream tracks:", remoteStream.getTracks().map(track => track.kind));

            const remoteVideoTrack = remoteStream.getVideoTracks()[0];
            const remoteAudioTrack = remoteStream.getAudioTracks()[0];

            if (remoteVideoTrack) {
                console.log("  [Client] Found remote video track:", remoteVideoTrack);
            } else {
                console.warn("  [Client] No remote video track found in the stream.");
            }

            if (remoteAudioTrack) {
                console.log("  [Client] Found remote audio track:", remoteAudioTrack);
            } else {
                console.warn("  [Client] No remote audio track found in the stream.");
            }

            if (!remoteVideo.srcObject || remoteVideo.srcObject.id !== remoteStream.id) {
                remoteVideo.srcObject = remoteStream;
                console.log("✅ [Client] Remote video stream set. srcObject ID:", remoteVideo.srcObject.id);
            } else {
                console.log("⚠️ [Client] Remote video stream already set or same ID.");
            }
        } else {
            console.warn("⚠️ [Client] No streams in the track event!");
        }
    });

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            ws.send(JSON.stringify({ type: 'candidate', candidate: event.candidate }));
        }
    };

    peerConnection.oniceconnectionstatechange = () => {
        console.log("🧊 [Client] ICE Connection State:", peerConnection.iceConnectionState);
        if (peerConnection.iceConnectionState === 'disconnected' ||
            peerConnection.iceConnectionState === 'failed' ||
            peerConnection.iceConnectionState === 'closed') {
            console.warn("❗ [Client] ICE connection state changed to:", peerConnection.iceConnectionState);
            addChatMessage('Connection with stranger lost.');
            cleanupConnection();
            alert("Connection lost. Click 'Next' to find a new match.");
            startChatBtn.disabled = false;
            nextBtn.disabled = true;
            isChatting = false;
        }
    };
}

function createAndSendOffer() {
    peerConnection.createOffer()
        .then(offer => peerConnection.setLocalDescription(offer))
        .then(() => {
            ws.send(JSON.stringify({ type: 'offer', offer: peerConnection.localDescription }));
            console.log("📤 [Client] Sent offer to stranger.");
        })
        .catch(error => {
            console.error('❗ [Client] Error creating offer:', error);
            alert("Error creating offer. Please try again.");
            startChatBtn.disabled = false;
            nextBtn.disabled = true;
            hideSearchingAnimation();
        });
}

sendBtn.onclick = () => {
    const text = messageInput.value.trim();
    if (text !== '' && isChatting) {
        addChatMessage(`You: ${text}`);
        ws.send(JSON.stringify({ type: 'text', text }));
        messageInput.value = '';
    } else if (!isChatting) {
        alert("Please connect to a stranger before sending messages.");
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
        console.log("🧹 [Client] Closing peer connection.");
        peerConnection.close();
        peerConnection = null;
    }
    if (remoteVideo.srcObject) {
        console.log("🎬 [Client] Stopping remote video tracks.");
        remoteVideo.srcObject.getTracks().forEach(track => track.stop());
        remoteVideo.srcObject = null;
    }
    if (localVideo.srcObject) {
        console.log("📹 [Client] Stopping local video tracks.");
        localVideo.srcObject.getTracks().forEach(track => track.stop());
        localVideo.srcObject = null;
    }
}

function detectNSFW() {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    function analyzeFrame() {
        if (!localStream || !nsfwModel || localVideo.videoWidth === 0 || localVideo.videoHeight === 0) {
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
                console.warn("⚠️ [Client] NSFW content detected!");
            }
        }).catch(error => {
            console.error("❗ [Client] Error during NSFW classification:", error); //error
            flowerOverlay.style.display = 'none';
        });

        setTimeout(analyzeFrame, 1000);
    }

    analyzeFrame();
}

// Start camera on page load
startCamera();

// Handle WebSocket connection open event
ws.onopen = () => {
    console.log("✅ [Client] WebSocket connection established.");
    startChatBtn.disabled = false; // Enable start button when connected
    nextBtn.disabled = true;
    hideSearchingAnimation(); // Hide initial "Waiting..." message on reconnect
};

// Handle WebSocket connection close event
ws.onclose = () => {
    console.log("❌ [Client] WebSocket connection closed.");
    startChatBtn.disabled = true;
    nextBtn.disabled = true;
    showSearchingAnimation(); // Show loading on disconnect as well
    searchingMessageElement.innerHTML = "Connection to the server lost. Please refresh the page.";
};

// Handle WebSocket errors
ws.onerror = (error) => {
    console.error("❗ [Client] WebSocket error:", error);
    alert("An error occurred with the server connection.");
    showSearchingAnimation(); // Show loading on error as well
    searchingMessageElement.innerHTML = "An error occurred with the server connection.";
};