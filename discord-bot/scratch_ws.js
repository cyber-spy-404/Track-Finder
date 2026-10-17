const WebSocket = require("ws");

const ws = new WebSocket("ws://127.0.0.1:2333/v4/websocket", {
  headers: {
    Authorization: "youshallnotpass",
    "User-Id": "1559615126406168646",
    "Client-Name": "HalalMusic"
  }
});

ws.on("open", () => {
  console.log("WS OPEN SUCCESS!");
});

ws.on("message", (data) => {
  console.log("WS MESSAGE:", data.toString());
});

ws.on("error", (err) => {
  console.error("WS ERROR:", err.message);
});

ws.on("close", (code, reason) => {
  console.log("WS CLOSE:", code, reason.toString());
});
