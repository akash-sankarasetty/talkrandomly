const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const chat = document.getElementById('chat');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');

const ws = new WebSocket(`wss://${window.location.host}`);

let peerConnection;
let localStream;
let remoteStream;
let isCaller = false;

const config = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

navigator.mediaDevices.getUserMedia({ video: true, audio: true })
.then(stream => {
    localStream = stream;
    localVideo.srcObject = stream;  // Show local video

    // Wait for WebSocket messages
    ws.onmessage = async (event) => {
        let rawData = event.data;
        if (rawData instanceof Blob) {
            rawData = await rawData.text();
        }
        const data = JSON.parse(rawData);

        if (data.type === 'match') {
            startPeerConnection();
            isCaller = true;
            if (isCaller) {
                createAndSendOffer();
            }
        } else if (data.type === 'offer') {
            startPeerConnection();
            isCaller = false;
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            ws.send(JSON.stringify({ type: 'answer', answer: peerConnection.localDescription }));
        } else if (data.type === 'answer') {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
        } else if (data.type === 'candidate') {
            if (data.candidate && peerConnection) {
                await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
            }
        } else if (data.type === 'text') {
            addChatMessage(`Stranger: ${data.text}`);
        } else if (data.type === 'partner_left') {
            addChatMessage('Stranger left the chat.');
            if (peerConnection) {
                peerConnection.close();
                peerConnection = null;
                remoteVideo.srcObject = null; // Reset remote video
            }
        }
    };
})
.catch(error => {
    console.error('Error accessing media devices.', error);
});

// Create the peer connection and handle tracks
function startPeerConnection() {
    if (peerConnection) return;

    peerConnection = new RTCPeerConnection(config);

    // Add the local stream's tracks to peer connection
    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });

    // Handle ICE candidates
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            ws.send(JSON.stringify({ type: 'candidate', candidate: event.candidate }));
        }
    };

    // Handle remote tracks (this is where the stranger's video will come from)
    peerConnection.ontrack = (event) => {
        if (!remoteStream) {
            remoteStream = new MediaStream();
            remoteVideo.srcObject = remoteStream; // Bind to remote video element
        }
        remoteStream.addTrack(event.track); // Add the remote track to the stream
    };
}

// Create and send an offer to the remote peer
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

// Send text message
sendBtn.onclick = () => {
    const text = messageInput.value;
    if (text.trim() !== '') {
        addChatMessage(`You: ${text}`);
        ws.send(JSON.stringify({ type: 'text', text }));
        messageInput.value = '';
    }
};

// Display chat messages
function addChatMessage(message) {
    const div = document.createElement('div');
    div.textContent = message;
    chat.appendChild(div);
    chat.scrollTop = chat.scrollHeight;
}
