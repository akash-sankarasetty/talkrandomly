const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let waitingUser = null;
let rooms = {}; // Track rooms by room ID

app.use(express.static('public'));

// Serve the admin panel
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// API to return active room information
app.get('/admin/status', (req, res) => {
    const roomList = Object.entries(rooms).map(([roomId, peers]) => ({
        roomId,
        user1: peers[0]?.id,
        user2: peers[1]?.id,
    }));
    res.json(roomList);
});

wss.on('connection', (ws) => {
    ws.id = uuidv4();
    ws.partner = null;

    console.log(`New user connected: ${ws.id}`);

    if (waitingUser) {
        // Create a room ID
        const roomId = uuidv4();

        ws.partner = waitingUser;
        waitingUser.partner = ws;

        ws.roomId = roomId;
        waitingUser.roomId = roomId;

        rooms[roomId] = [waitingUser, ws];

        ws.send(JSON.stringify({ type: 'match' }));
        waitingUser.send(JSON.stringify({ type: 'match' }));

        waitingUser = null;
    } else {
        waitingUser = ws;
    }

    ws.on('message', (message) => {
        if (ws.partner && ws.partner.readyState === WebSocket.OPEN) {
            ws.partner.send(message);
        }
    });

    ws.on('close', () => {
        console.log(`User disconnected: ${ws.id}`);

        // Notify partner
        if (ws.partner && ws.partner.readyState === WebSocket.OPEN) {
            ws.partner.send(JSON.stringify({ type: 'partner_left' }));
            ws.partner.partner = null;
        }

        // Remove from rooms
        if (ws.roomId && rooms[ws.roomId]) {
            delete rooms[ws.roomId];
        }

        if (waitingUser === ws) {
            waitingUser = null;
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
