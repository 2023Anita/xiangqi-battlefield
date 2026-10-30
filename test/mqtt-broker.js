// 本地 MQTT-over-WebSocket broker for tests (aedes + ws). Usage: require('./mqtt-broker')(port) or `node test/mqtt-broker.js 9883`.
// Needs aedes@0.51 and ws (installed in ../.pw/node_modules; run with NODE_PATH=../.pw/node_modules).
module.exports = function startBroker(port = 9883) {
  const aedes = require('aedes')();
  const http = require('http'), { WebSocketServer, createWebSocketStream } = require('ws');
  const server = http.createServer();
  const wss = new WebSocketServer({ server, handleProtocols: (ps) => (ps.has('mqtt') ? 'mqtt' : false) });
  wss.on('connection', (sock) => aedes.handle(createWebSocketStream(sock)));
  return new Promise((res) => server.listen(port, '127.0.0.1', () => res({ aedes, server, wss, url: 'ws://localhost:' + port + '/mqtt', close: () => { wss.clients.forEach((c) => c.terminate()); server.close(); aedes.close(); } })));
};
if (require.main === module) module.exports(+process.argv[2] || 9883).then((b) => console.log('MQTT broker on', b.url));
