const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const flowerOverlay = document.getElementById('flowerOverlay');
const chat = document.getElementById('chat');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');

const ws = new WebSocket(`wss://${window.location.host}`);

let peerConnection;
let localStream;
let remoteStream;
let isCaller = false;
let nsfwModel;

const config = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

// Load NSFW model
nsfwjs.load().then(model => {
    nsfwModel = model;
    console.log("NSFWJS model loaded.");
    startCamera();
}).catch(err => {
    console.error("Failed to load NSFWJS model:", err);
});

function startCamera() {
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
        .then(stream => {
            localStream = stream;
            localVideo.srcObject = stream;

            detectNSFW(); // Start NSFW loop

            ws.onmessage = async (event) => {
                let rawData = event.data;
                if (rawData instanceof Blob) rawData = await rawData.text();
                const data = JSON.parse(rawData);

                if (data.type === 'match') {
                    isCaller = true;
                    startPeerConnection();
                    createAndSendOffer();  // Only caller sends offer
                }
                else if (data.type === 'offer') {
                    isCaller = false;
                    startPeerConnection();
                    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
                    const answer = await peerConnection.createAnswer();
                    await peerConnection.setLocalDescription(answer);
                    ws.send(JSON.stringify({ type: 'answer', answer: peerConnection.localDescription }));
                }
                else if (data.type === 'answer') {
                    if (peerConnection.signalingState === 'have-local-offer') {
                        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
                    }
                }
                else if (data.type === 'candidate') {
                    if (data.candidate && peerConnection) {
                        try {
                            await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
                        } catch (e) {
                            console.error('Error adding ICE candidate:', e);
                        }
                    }
                }
                else if (data.type === 'text') {
                    addChatMessage(`Stranger: ${data.text}`);
                }
                else if (data.type === 'partner_left') {
                    addChatMessage('Stranger left the chat.');
                    if (peerConnection) {
                        peerConnection.close();
                        peerConnection = null;
                    }
                    remoteVideo.srcObject = null;
                    remoteStream = null;
                }
            };
        })
        .catch(error => {
            console.error('Error accessing media devices:', error);
        });
}

function startPeerConnection() {
    if (peerConnection) return;

    peerConnection = new RTCPeerConnection(config);

    // Add local tracks
    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });

    // Handle ICE candidates
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            ws.send(JSON.stringify({ type: 'candidate', candidate: event.candidate }));
        }
    };

    // Handle remote track
    peerConnection.ontrack = (event) => {
        if (!remoteStream) {
            remoteStream = new MediaStream();
            remoteVideo.srcObject = remoteStream;
        }
        remoteStream.addTrack(event.track);
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

// 🔍 NSFW Detection Loop
function detectNSFW() {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    function analyzeFrame() {
        if (!localStream || !nsfwModel) return;

        canvas.width = localVideo.videoWidth;
        canvas.height = localVideo.videoHeight;
        ctx.drawImage(localVideo, 0, 0, canvas.width, canvas.height);

        nsfwModel.classify(canvas).then(predictions => {
            const result = predictions[0];
            const shouldHide = ['Porn', 'Hentai', 'Sexy'].includes(result.className) && result.probability > 0.7;

            // Show flower overlay if NSFW content is detected
            flowerOverlay.style.display = shouldHide ? 'block' : 'none';
        }).catch(console.error);

        setTimeout(analyzeFrame, 1000);
    }

    analyzeFrame();
}
