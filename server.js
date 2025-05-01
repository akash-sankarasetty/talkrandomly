const express = require('express');
const WebSocket = require('ws');
const app = express();
const port = process.env.PORT || 3000;

app.use(express.static('public'));

const wss = new WebSocket.Server({ noServer: true });

const waitingClients = [];
const pairs = new Map(); // Map<ws, ws>

wss.on('connection', (ws) => {
    console.log('🔌 New client connected');

    if (waitingClients.length > 0) {
        const partner = waitingClients.pop();
        pairs.set(ws, partner);
        pairs.set(partner, ws);

        ws.send(JSON.stringify({ type: 'match' }));
        partner.send(JSON.stringify({ type: 'match' }));

        console.log('✅ Matched two clients');
    } else {
        waitingClients.push(ws);
        ws.send(JSON.stringify({ type: 'waiting' })); //send waiting message
        console.log('⏳ Client waiting for match');
    }

    ws.on('message', (message) => {
        try {
            const parsedMessage = JSON.parse(message);
             if (parsedMessage.type === 'next') {
                const partner = pairs.get(ws);
                if (partner && partner.readyState === WebSocket.OPEN) {
                    partner.send(JSON.stringify({ type: 'partner_left' }));
                    pairs.delete(partner);
                    pairs.delete(ws);
                } else if (waitingClients.includes(ws)) {
                    const index = waitingClients.indexOf(ws);
                    if (index !== -1) waitingClients.splice(index, 1);
                }
                waitingClients.push(ws);
                ws.send(JSON.stringify({ type: 'waiting' }));
                console.log('🔄 Client requesting next match');

                 if (waitingClients.length >= 2) {
                    const partner1 = waitingClients.shift();
                    const partner2 = waitingClients.shift();
                    pairs.set(partner1, partner2);
                    pairs.set(partner2, partner1);
                    partner1.send(JSON.stringify({ type: 'match' }));
                    partner2.send(JSON.stringify({ type: 'match' }));
                    console.log('✅ Matched two waiting clients after "next"');
                }
                return;
            }

            const partner = pairs.get(ws);
            if (partner && partner.readyState === WebSocket.OPEN) {
                partner.send(message);
            }
        } catch (error) {
            console.error('Failed to parse message or handle:', error);
        }
    });

    ws.on('close', () => {
        const partner = pairs.get(ws);
        if (partner && partner.readyState === WebSocket.OPEN) {
            partner.send(JSON.stringify({ type: 'partner_left' }));
            pairs.delete(partner);
        }

        pairs.delete(ws);

        // Remove from waiting list if unmatched
        const index = waitingClients.indexOf(ws);
        if (index !== -1) waitingClients.splice(index, 1);

        console.log('❌ Client disconnected');
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