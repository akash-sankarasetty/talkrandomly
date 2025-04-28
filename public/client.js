const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const chat = document.getElementById('chat');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');

const ws = new WebSocket(`wss://${window.location.host}`);

let peerConnection;
let localStream;
let isCaller = false;  // <-- IMPORTANT: New flag!

const config = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

navigator.mediaDevices.getUserMedia({ video: true, audio: true })
.then(stream => {
    localStream = stream;
    localVideo.srcObject = stream;

    ws.onmessage = async (event) => {
        let rawData = event.data;
        if (rawData instanceof Blob) {
            rawData = await rawData.text();
        }
        const data = JSON.parse(rawData);

        if (data.type === 'match') {
            startPeerConnection(localStream);
            isCaller = true;  // Only caller creates offer
            if (isCaller) {
                createAndSendOffer();
            }
        } else if (data.type === 'offer') {
            startPeerConnection(localStream);
            isCaller = false;
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            ws.send(JSON.stringify({ type: 'answer', answer }));
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
                remoteVideo.srcObject = null;
            }
        }
    };
})
.catch(error => {
    console.error('Error accessing media devices.', error);
});

function startPeerConnection(stream) {
    if (peerConnection) return; // prevent multiple connections
    peerConnection = new RTCPeerConnection(config);

    stream.getTracks().forEach(track => {
        peerConnection.addTrack(track, stream);
    });

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            ws.send(JSON.stringify({ type: 'candidate', candidate: event.candidate }));
        }
    };

    peerConnection.ontrack = (event) => {
        remoteVideo.srcObject = event.streams[0];
    };
}

function createAndSendOffer() {
    peerConnection.createOffer()
    .then(offer => {
        return peerConnection.setLocalDescription(offer);
    })
    .then(() => {
        ws.send(JSON.stringify({ type: 'offer', offer: peerConnection.localDescription }));
    })
    .catch(error => {
        console.error('Error creating offer:', error);
    });
}

sendBtn.onclick = () => {
    const text = messageInput.value;
    if (text.trim() !== '') {
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
