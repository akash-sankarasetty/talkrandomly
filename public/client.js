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
    console.log("✅ NSFWJS model loaded.");
}).catch(err => {
    console.error("❌ Failed to load NSFWJS model:", err);
    alert("Failed to load NSFW detection model.  The app may not function correctly."); // Inform the user
});

// Start local camera
function startCamera() {
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
        .then(stream => {
            localStream = stream;
            localVideo.srcObject = stream;
            detectNSFW();
        })
        .catch(error => {
            console.error('Error accessing media devices:', error);
            alert("Please grant camera and microphone permissions to use this application.");
            startChatBtn.disabled = false; //Re-enable start chat
        });
}

startChatBtn.onclick = () => {
    if (!localStream) {
        alert("Please allow camera and microphone access to start chatting.");
        return;
    }
    if (!isChatting) {
        ws.send(JSON.stringify({ type: 'start_chat' }));
        console.log("🔄 Searching for a stranger...");
        startChatBtn.disabled = true;
        nextBtn.disabled = true;
        searchingMessageElement.style.display = 'block';
    } else {
        alert("You are already in a chat. Click 'Next' to find a new partner.");
    }
};

nextBtn.onclick = () => {
    if (isChatting) {
        cleanupConnection();
        ws.send(JSON.stringify({ type: 'next' }));
        console.log("🔄 Searching for a new stranger...");
        startChatBtn.disabled = true;
        nextBtn.disabled = true;
        searchingMessageElement.style.display = 'block';
        isChatting = false;
    } else {
        alert("Click 'Start Chat' to find a partner first.");
    }
};

ws.onmessage = async (event) => {
    let rawData = event.data;
    if (rawData instanceof Blob) rawData = await rawData.text();
    const data = JSON.parse(rawData);

    if (data.type === 'match') {
        console.log("✅ Matched with a stranger!");
        isCaller = true;
        isChatting = true;
        startPeerConnection();
        createAndSendOffer();
        startChatBtn.disabled = true;
        nextBtn.disabled = false;
        searchingMessageElement.style.display = 'none';
    } else if (data.type === 'offer') {
        console.log("🤝 Received offer from stranger.");
        isCaller = false;
        isChatting = true;
        startPeerConnection();
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        ws.send(JSON.stringify({ type: 'answer', answer: peerConnection.localDescription }));
        startChatBtn.disabled = true;
        nextBtn.disabled = false;
        searchingMessageElement.style.display = 'none';
    } else if (data.type === 'answer') {
        console.log("👍 Received answer from stranger.");
        if (peerConnection && peerConnection.signalingState === 'have-local-offer') {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
        }
    } else if (data.type === 'candidate') {
        if (data.candidate && peerConnection) {
            try {
                await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
            } catch (e) {
                console.error('Error adding ICE candidate:', e);
            }
        }
    } else if (data.type === 'text') {
        addChatMessage(`Stranger: ${data.text}`);
    } else if (data.type === 'partner_left') {
        addChatMessage('Stranger left the chat.');
        cleanupConnection();
        alert("The stranger has left. Click 'Next' to find a new match.");
        startChatBtn.disabled = false;
        nextBtn.disabled = true;
        isChatting = false;
    } else if (data.type === 'no_partners') {
        alert("No other users are currently available. Please try again later.");
        startChatBtn.disabled = false;
        nextBtn.disabled = true;
        searchingMessageElement.style.display = 'none';
    } else if (data.type === 'waiting') {
        searchingMessageElement.textContent = "Waiting for a partner...";
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
        console.log("🎥 Received remote track via addEventListener:", event.track.kind);
        console.log("   Event:", event); // Log the entire event for inspection
        if (event.streams && event.streams.length > 0) {
            const remoteStream = event.streams[0];
            console.log("   Remote stream ID:", remoteStream.id);
             console.log("   Remote stream tracks:", remoteStream.getTracks().map(track => track.kind));
            if (!remoteVideo.srcObject || remoteVideo.srcObject.id !== remoteStream.id) {
                remoteVideo.srcObject = remoteStream;
                console.log("✅ Remote video stream set. srcObject ID:", remoteVideo.srcObject.id);
            } else {
                console.log("⚠️ Remote video stream already set or same ID.");
            }
        } else {
             console.warn("⚠️ No streams in the track event!");
        }
    });

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            ws.send(JSON.stringify({ type: 'candidate', candidate: event.candidate }));
        }
    };

    peerConnection.oniceconnectionstatechange = () => {
        console.log("ICE Connection State:", peerConnection.iceConnectionState);
        if (peerConnection.iceConnectionState === 'disconnected' ||
            peerConnection.iceConnectionState === 'failed' ||
            peerConnection.iceConnectionState === 'closed') {
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
            console.log("📤 Sent offer to stranger.");
        })
        .catch(error => {
            console.error('Error creating offer:', error);
            alert("Error creating offer. Please try again.");
            startChatBtn.disabled = false;
            nextBtn.disabled = true;
            searchingMessageElement.style.display = 'none';
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
        peerConnection.close();
        peerConnection = null;
    }
    if (remoteVideo.srcObject) {
        remoteVideo.srcObject.getTracks().forEach(track => track.stop());
        remoteVideo.srcObject = null;
    }
    if (localVideo.srcObject) {
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
                console.warn("⚠️ NSFW content detected!");
            }
        }).catch(error => {
            console.error("Error during NSFW classification:", error); //error
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
    console.log("✅ WebSocket connection established.");
    startChatBtn.disabled = false; // Enable start button when connected
    nextBtn.disabled = true;
};

// Handle WebSocket connection close event
ws.onclose = () => {
    console.log("❌ WebSocket connection closed.");
    startChatBtn.disabled = true;
    nextBtn.disabled = true;
    searchingMessageElement.style.display = 'none';
    alert("Connection to the server lost. Please refresh the page.");
};

// Handle WebSocket errors
ws.onerror = (error) => {
    console.error("WebSocket error:", error);
    alert("An error occurred with the server connection.");
};