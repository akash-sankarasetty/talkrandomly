const express = require('express');
const WebSocket = require('ws');
const app = express();
const port = process.env.PORT || 3000;

app.use(express.static('public'));

const wss = new WebSocket.Server({ noServer: true });

const waitingClients = new Set(); // Use a Set for easier addition and deletion
const pairs = new Map(); // Map<ws, ws>

function findAndMatch() {
    if (waitingClients.size >= 2) {
        const iterator = waitingClients.values();
        const partner1 = iterator.next().value;
        waitingClients.delete(partner1);
        const partner2 = iterator.next().value;
        waitingClients.delete(partner2);

        pairs.set(partner1, partner2);
        pairs.set(partner2, partner1);

        if (partner1.readyState === WebSocket.OPEN) {
            partner1.send(JSON.stringify({ type: 'match' }));
            console.log('✅ [Server] Matched client (after "next"):', partner1._socket.remoteAddress);
        }
        if (partner2.readyState === WebSocket.OPEN) {
            partner2.send(JSON.stringify({ type: 'match' }));
            console.log('✅ [Server] Matched client (after "next"):', partner2._socket.remoteAddress);
        }
        console.log('✅ [Server] Successfully rematched two waiting clients.');
    } else if (waitingClients.size === 1) {
        const waitingClient = waitingClients.values().next().value;
        if (waitingClient.readyState === WebSocket.OPEN) {
            waitingClient.send(JSON.stringify({ type: 'waiting' }));
            console.log('⏳ [Server] One client remaining in the waiting list.');
        }
    } else {
        console.log('ℹ️ [Server] No clients in the waiting list.');
    }
}

wss.on('connection', (ws) => {
    console.log('🔌 [Server] New client connected:', ws._socket.remoteAddress);

    waitingClients.add(ws);
    ws.send(JSON.stringify({ type: 'waiting' }));
    console.log('⏳ [Server] Client added to waiting list.');
    findAndMatch();

    ws.on('message', (message) => {
        try {
            const parsedMessage = JSON.parse(message);
            if (parsedMessage.type === 'next') {
                const partner = pairs.get(ws);
                if (partner) {
                    if (partner.readyState === WebSocket.OPEN) {
                        partner.send(JSON.stringify({ type: 'partner_left' }));
                    }
                    pairs.delete(partner);
                    pairs.delete(ws);
                    console.log('💔 [Server] Removed pair due to "next" from:', ws._socket.remoteAddress);
                } else if (waitingClients.has(ws)) {
                    waitingClients.delete(ws);
                    console.log('🗑️ [Server] Removed from waiting list due to "next":', ws._socket.remoteAddress);
                }

                waitingClients.add(ws);
                ws.send(JSON.stringify({ type: 'waiting' }));
                console.log('⏳ [Server] Client re-added to waiting list after "next".');
                findAndMatch();
                return;
            }

            const partner = pairs.get(ws);
            if (partner && partner.readyState === WebSocket.OPEN) {
                partner.send(message);
            }
        } catch (error) {
            console.error('❗ [Server] Failed to parse message or handle:', error);
        }
    });

    ws.on('close', () => {
        const partner = pairs.get(ws);
        if (partner && partner.readyState === WebSocket.OPEN) {
            partner.send(JSON.stringify({ type: 'partner_left' }));
            pairs.delete(partner);
        }
        pairs.delete(ws);
        waitingClients.delete(ws);
        console.log('❌ [Server] Client disconnected:', ws._socket.remoteAddress);
        findAndMatch(); // Try to match any remaining waiting clients
    });
});

const server = app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});

server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
    });
});