const express = require('express');
const WebSocket = require('ws');
const app = express();
const port = process.env.PORT || 3000;

// Serve static files (like HTML, CSS, JS)
app.use(express.static('public'));

// WebSocket server
const wss = new WebSocket.Server({ noServer: true });

wss.on('connection', (ws) => {
    ws.on('message', (message) => {
        // Broadcast received message to all connected clients
        wss.clients.forEach((client) => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        });
    });

    ws.on('close', () => {
        // Notify others that the partner has left
        wss.clients.forEach((client) => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ type: 'partner_left' }));
            }
        });
    });
});

// Start HTTP and WebSocket server
const server = app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});

server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
    });
});
