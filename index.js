const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

let waitingQueue = [];
let pairs = [];

const server = http.createServer((req, res) => {
    if (req.url === "/") {
        fs.readFile(path.join(__dirname, "public", "index.html"), "utf8", (err, data) => {
            if (err) { res.writeHead(500); return res.end("Error loading page"); }
            res.writeHead(200, { "Content-Type": "text/html" });
            res.end(data);
        });
    } else if (req.url === "/script.js") {
        fs.readFile(path.join(__dirname, "public", "script.js"), "utf8", (err, data) => {
            if (err) { res.writeHead(500); return res.end("Error loading script"); }
            res.writeHead(200, { "Content-Type": "application/javascript" });
            res.end(data);
        });
    } else {
        res.writeHead(404);
        res.end("Not found");
    }
});

server.listen(3000, () => console.log("Server running at http://localhost:3000"));

// --------------------
// Minimal WebSocket server
// --------------------
server.on("upgrade", (req, socket, head) => {
    if (req.headers["upgrade"] !== "websocket") {
        socket.end("HTTP/1.1 400 Bad Request");
        return;
    }

    const key = req.headers["sec-websocket-key"];
    const acceptKey = crypto.createHash("sha1")
        .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
        .digest("base64");

    socket.write([
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Accept: ${acceptKey}`,
    ].join("\r\n") + "\r\n\r\n");

    // Add user to queue if needed
    if (waitingQueue.length === 0) {
        waitingQueue.push(socket);
        sendWebSocketMessage(socket, "Waiting for a partner...");
    } else {
        const partner = waitingQueue.shift();
        pairs.push({ user1: partner, user2: socket });
        sendWebSocketMessage(partner, "Partner connected! Say hi!");
        sendWebSocketMessage(socket, "Partner connected! Say hi!");
    }

    // Handle incoming messages
    socket.on("data", (buffer) => {
        const message = decodeWebSocketMessage(buffer);
        if (!message) return;

        if (message === "/next") {
            handleNext(socket);
            return;
        }

        const pair = pairs.find(p => p.user1 === socket || p.user2 === socket);
        if (!pair) return;

        const target = pair.user1 === socket ? pair.user2 : pair.user1;
        if (target) sendWebSocketMessage(target, message);
    });

    socket.on("close", () => removeSocket(socket));
    socket.on("error", () => removeSocket(socket));
});

// --------------------
// Handle /next command
// --------------------
function handleNext(socket) {
    const pairIndex = pairs.findIndex(p => p.user1 === socket || p.user2 === socket);
    if (pairIndex !== -1) {
        const pair = pairs[pairIndex];
        const partner = pair.user1 === socket ? pair.user2 : pair.user1;

        if (partner && partner.writable) sendWebSocketMessage(partner, "Partner left. Waiting for new partner...");

        pairs.splice(pairIndex, 1);

        if (partner && partner.writable) waitingQueue.push(partner);
    }

    waitingQueue.push(socket);
    sendWebSocketMessage(socket, "Looking for a new partner...");

    if (waitingQueue.length >= 2) {
        const user1 = waitingQueue.shift();
        const user2 = waitingQueue.shift();
        pairs.push({ user1, user2 });
        sendWebSocketMessage(user1, "Partner connected! Say hi!");
        sendWebSocketMessage(user2, "Partner connected! Say hi!");
    }
}

// --------------------
// Remove disconnected socket
// --------------------
function removeSocket(socket) {
    waitingQueue = waitingQueue.filter(s => s !== socket);
    pairs = pairs.filter(p => {
        if (p.user1 === socket || p.user2 === socket) {
            const other = p.user1 === socket ? p.user2 : p.user1;
            if (other && other.writable) sendWebSocketMessage(other, "Partner disconnected.");
            return false;
        }
        return true;
    });
}

// --------------------
// Minimal WebSocket helpers
// --------------------
function decodeWebSocketMessage(buffer) {
    const firstByte = buffer[0];
    const opCode = firstByte & 0x0f;
    if (opCode === 8) return null;
    const secondByte = buffer[1];
    let length = secondByte & 0x7f;
    let maskStart = 2;
    if (length === 126) { length = buffer.readUInt16BE(2); maskStart = 4; }
    else if (length === 127) { length = Number(buffer.readBigUInt64BE(2)); maskStart = 10; }
    const masks = buffer.slice(maskStart, maskStart + 4);
    const data = buffer.slice(maskStart + 4, maskStart + 4 + length);
    const decoded = Buffer.alloc(length);
    for (let i = 0; i < length; i++) decoded[i] = data[i] ^ masks[i % 4];
    return decoded.toString("utf8");
}

function sendWebSocketMessage(socket, message) {
    const messageBuffer = Buffer.from(message);
    const length = messageBuffer.length;
    let payload = null;
    if (length < 126) {
        payload = Buffer.alloc(2 + length);
        payload[0] = 0x81;
        payload[1] = length;
        messageBuffer.copy(payload, 2);
    } else if (length < 65536) {
        payload = Buffer.alloc(4 + length);
        payload[0] = 0x81;
        payload[1] = 126;
        payload.writeUInt16BE(length, 2);
        messageBuffer.copy(payload, 4);
    } else {
        payload = Buffer.alloc(10 + length);
        payload[0] = 0x81;
        payload[1] = 127;
        payload.writeBigUInt64BE(BigInt(length), 2);
        messageBuffer.copy(payload, 10);
    }
    socket.write(payload);
}
