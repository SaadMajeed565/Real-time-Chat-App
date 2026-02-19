const chatDiv = document.getElementById("chat");
const input = document.getElementById("message");
const sendBtn = document.getElementById("send");
const nextBtn = document.getElementById("next");

const ws = new WebSocket(`ws://${location.host}`);

ws.onopen = () => console.log("Connected");

ws.onmessage = (event) => {
    const msgDiv = document.createElement("div");
    msgDiv.classList.add("message", "received");
    msgDiv.textContent = event.data;
    chatDiv.appendChild(msgDiv);
    chatDiv.scrollTop = chatDiv.scrollHeight;
};

function sendMessage() {
    const text = input.value.trim();
    if (!text) return;
    const myMsg = document.createElement("div");
    myMsg.classList.add("message", "sent");
    myMsg.textContent = text;
    chatDiv.appendChild(myMsg);
    chatDiv.scrollTop = chatDiv.scrollHeight;

    ws.send(text);
    input.value = "";
}

function nextPartner() {
    chatDiv.innerHTML = "";
    ws.send("/next"); // server can handle it to disconnect and queue user again
}

sendBtn.addEventListener("click", sendMessage);
input.addEventListener("keypress", (e) => { if(e.key==="Enter") sendMessage(); });
nextBtn.addEventListener("click", nextPartner);
