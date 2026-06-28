import { createHash } from 'node:crypto';
import { once } from 'node:events';
import http from 'node:http';
import net from 'node:net';

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export function encodeWebSocketText(text) {
  const payload = Buffer.from(text);
  if (payload.length < 126) {
    return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
  }
  if (payload.length <= 65535) {
    const header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
    return Buffer.concat([header, payload]);
  }
  throw new Error('asha-demo devtools frames support JSON messages up to 65535 bytes');
}

export function decodeWebSocketText(buffer) {
  const first = buffer[0];
  const second = buffer[1];
  if (first === undefined || second === undefined || (first & 0x0f) !== 0x1) {
    throw new Error('expected a text websocket frame');
  }
  const masked = (second & 0x80) === 0x80;
  let length = second & 0x7f;
  let offset = 2;
  if (length === 126) {
    length = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (length === 127) {
    throw new Error('large websocket frames are not supported by this smoke transport');
  }
  let mask = null;
  if (masked) {
    mask = buffer.subarray(offset, offset + 4);
    offset += 4;
  }
  const payload = Buffer.from(buffer.subarray(offset, offset + length));
  if (mask !== null) {
    for (let i = 0; i < payload.length; i += 1) {
      payload[i] = payload[i] ^ mask[i % 4];
    }
  }
  return payload.toString('utf8');
}

function encodeClientText(text) {
  const payload = Buffer.from(text);
  const mask = Buffer.from([0x12, 0x34, 0x56, 0x78]);
  const masked = Buffer.from(payload);
  for (let i = 0; i < masked.length; i += 1) {
    masked[i] = masked[i] ^ mask[i % 4];
  }
  if (payload.length < 126) {
    return Buffer.concat([Buffer.from([0x81, 0x80 | payload.length]), mask, masked]);
  }
  if (payload.length <= 65535) {
    const header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(payload.length, 2);
    return Buffer.concat([header, mask, masked]);
  }
  throw new Error('asha-demo devtools client frames support JSON messages up to 65535 bytes');
}

export async function createJsonWebSocketServer({ host, port, handleMessage }) {
  const server = http.createServer();
  server.on('upgrade', (request, socket) => {
    const key = request.headers['sec-websocket-key'];
    if (typeof key !== 'string') {
      socket.destroy();
      return;
    }
    const accept = createHash('sha1').update(`${key}${WS_GUID}`).digest('base64');
    socket.write([
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${accept}`,
      '',
      '',
    ].join('\r\n'));
    socket.on('data', async (data) => {
      try {
        const requestMessage = JSON.parse(decodeWebSocketText(data));
        const response = await handleMessage(requestMessage);
        socket.write(encodeWebSocketText(JSON.stringify(response)));
      } catch (error) {
        socket.write(encodeWebSocketText(JSON.stringify({
          type: 'error',
          message: error instanceof Error ? error.message : String(error),
        })));
      }
    });
  });
  server.listen(port, host);
  await once(server, 'listening');
  const address = server.address();
  if (typeof address !== 'object' || address === null) {
    throw new Error('devtools server did not expose a TCP address');
  }
  return { server, endpoint: `ws://${host}:${address.port}` };
}

export async function exchangeJsonWebSocket(endpoint, message) {
  const url = new URL(endpoint);
  const socket = net.createConnection({
    host: url.hostname,
    port: Number(url.port),
  });
  await once(socket, 'connect');
  const key = 'YXNoYS1kZW1vLWRldnRvb2xz';
  socket.write([
    `GET ${url.pathname || '/'} HTTP/1.1`,
    `Host: ${url.host}`,
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Key: ${key}`,
    'Sec-WebSocket-Version: 13',
    '',
    '',
  ].join('\r\n'));

  let upgraded = false;
  let buffered = Buffer.alloc(0);
  socket.on('data', (chunk) => {
    buffered = Buffer.concat([buffered, chunk]);
  });
  while (!upgraded) {
    await once(socket, 'data');
    const headerEnd = buffered.indexOf('\r\n\r\n');
    if (headerEnd >= 0) {
      const header = buffered.subarray(0, headerEnd).toString('utf8');
      if (!header.includes('101 Switching Protocols')) {
        socket.destroy();
        throw new Error(`websocket upgrade failed: ${header}`);
      }
      buffered = buffered.subarray(headerEnd + 4);
      upgraded = true;
    }
  }
  socket.write(encodeClientText(JSON.stringify(message)));
  while (buffered.length === 0) {
    await once(socket, 'data');
  }
  const responseText = decodeWebSocketText(buffered);
  socket.destroy();
  return JSON.parse(responseText);
}
