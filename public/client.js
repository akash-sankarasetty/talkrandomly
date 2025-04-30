const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const flowerOverlay = document.getElementById('flowerOverlay');
const chat = document.getElementById('chat');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const startChatBtn = document.getElementById('startChatBtn');
const nextBtn = document.getElementById('nextBtn');

const ws = new WebSocket(`wss://${window.location.host}`);

let peerConnection;
let localStream;
let isCaller = false;
let nsfwModel;

const config = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

// Load NSFW model
nsfwjs.load().then(model => {
    nsfwModel = model;
    console.log("✅ NSFWJS model loaded.");
}).catch(err => {
    console.error("❌ Failed to load NSFWJS model:", err);
});

// Start camera and wait for user to start chat
function startCamera() {
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
        .then(stream => {
            localStream = stream;
            localVideo.srcObject = stream;
            detectNSFW();
        })
        .catch(error => {
            console.error('Error accessing media devices:', error);
        });
}

startChatBtn.onclick = () => {
    if (!localStream) {
        alert("Please allow camera and microphone access to start chatting.");
        return;
    }
    ws.send(JSON.stringify({ type: 'start_chat' }));
    console.log("🔄 Searching for a stranger...");
};

ws.onmessage = async (event) => {
    let rawData = event.data;
    if (rawData instanceof Blob) rawData = await rawData.text();
    const data = JSON.parse(rawData);

    if (data.type === 'match') {
        console.log("✅ Matched with a stranger!");
        isCaller = true;
        startPeerConnection();
        createAndSendOffer();
    } else if (data.type === 'offer') {
        isCaller = false;
        startPeerConnection();
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        ws.send(JSON.stringify({ type: 'answer', answer: peerConnection.localDescription }));
    } else if (data.type === 'answer') {
        if (peerConnection.signalingState === 'have-local-offer') {
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
        if (peerConnection) {
            peerConnection.close();
            peerConnection = null;
        }
        remoteVideo.srcObject = null;
        alert("The stranger has left. Click 'Next' to find a new match.");
    }
};

nextBtn.onclick = () => {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    remoteVideo.srcObject = null;
    ws.send(JSON.stringify({ type: 'next' }));
    console.log("🔄 Searching for a new stranger...");
};

function startPeerConnection() {
    if (peerConnection) return;

    peerConnection = new RTCPeerConnection(config);

    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            ws.send(JSON.stringify({ type: 'candidate', candidate: event.candidate }));
        }
    };

    peerConnection.ontrack = (event) => {
        console.log("🎥 Received remote track:", event.track.kind);
        remoteVideo.srcObject = event.streams[0];
        console.log("✅ Remote video stream set directly from event.streams[0]");
    };

    peerConnection.oniceconnectionstatechange = () => {
        console.log("ICE Connection State:", peerConnection.iceConnectionState);
    };
}

function createAndSendOffer() {
    peerConnection.createOffer()
        .then(offer => peerConnection.setLocalDescription(offer))
        .then(() => {
            ws.send(JSON.stringify({ type: 'offer', offer: peerConnection.localDescription }));
        })
        .catch(error => {
            console.error('Error creating offer:', error);
        });
}

sendBtn.onclick = () => {
    const text = messageInput.value.trim();
    if (text !== '') {
        addChatMessage(`You: ${text}`);
        ws.send(JSON.stringify({ type: 'text', text }));
        messageInput.value = '';
    }
};

function addChatMessage(message) {
    const div = document.createElement('div');
    div.textContent = message;
    chat.appendChild(div);
    chat.scrollTop = chat.scrollHeight;
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
        }).catch(console.error);

        setTimeout(analyzeFrame, 1000);
    }

    analyzeFrame();
}

// Initialize camera on page load
startCamera();
