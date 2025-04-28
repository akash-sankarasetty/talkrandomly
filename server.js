const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let waitingUser = null;

wss.on('connection', (ws) => {
    ws.id = uuidv4();
    ws.partner = null;

    if (waitingUser) {
        // Pair the users
        ws.partner = waitingUser;
        waitingUser.partner = ws;

        ws.send(JSON.stringify({ type: 'match' }));
        waitingUser.send(JSON.stringify({ type: 'match' }));

        waitingUser = null;
    } else {
        waitingUser = ws;
    }

    ws.on('message', (message) => {
        // Forward messages to the partner
        if (ws.partner) {
            ws.partner.send(message);
        }
    });

    ws.on('close', () => {
        if (ws.partner) {
            ws.partner.send(JSON.stringify({ type: 'partner_left' }));
            ws.partner.partner = null;
        }
        if (waitingUser === ws) {
            waitingUser = null;
        }
    });
});

app.use(express.static('public'));

// Use dynamic port from Render environment variable
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`Server started on http://localhost:${PORT}`);
});
