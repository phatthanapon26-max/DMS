(() => {
  'use strict';
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const chunkSize = 16000;
  const maximumImage = 6_000_000;

  function encode(bytes) {
    return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  }
  function decode(text) {
    return Uint8Array.from(atob(text.replaceAll('-', '+').replaceAll('_', '/')), char => char.charCodeAt(0));
  }

  async function keys(secret) {
    const bytes = decode(secret);
    if (bytes.length !== 32) throw new Error('Invalid pairing secret');
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const room = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
    const key = await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
    return { room, key };
  }

  async function signal(keys, slot, method = 'GET', description, signal) {
    const url = new URL('/api/scan-pair', location.origin);
    url.searchParams.set('room', keys.room);
    url.searchParams.set('slot', slot);
    const options = { method, signal };
    if (description) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encrypted = new Uint8Array(await crypto.subtle.encrypt({
        name: 'AES-GCM', iv, additionalData: encoder.encode(slot)
      }, keys.key, encoder.encode(JSON.stringify(description))));
      const packet = new Uint8Array(iv.length + encrypted.length);
      packet.set(iv);
      packet.set(encrypted, iv.length);
      options.headers = { 'Content-Type': 'application/json' };
      options.body = JSON.stringify({ payload: encode(packet) });
    }
    const response = await fetch(url, options);
    if (method === 'GET' && response.status === 404) return null;
    if (!response.ok) throw new Error('Pairing service unavailable');
    if (method !== 'GET') return;
    const { payload } = await response.json();
    const packet = decode(payload);
    const decoded = await crypto.subtle.decrypt({
      name: 'AES-GCM', iv: packet.subarray(0, 12), additionalData: encoder.encode(slot)
    }, keys.key, packet.subarray(12));
    return JSON.parse(decoder.decode(decoded));
  }

  async function waitForSignal(keys, slot, abort) {
    const deadline = Date.now() + 154000;
    while (!abort.aborted && Date.now() < deadline) {
      const description = await signal(keys, slot, 'GET', undefined, abort);
      if (description) return description;
      await new Promise(resolve => setTimeout(resolve, 1100));
    }
    throw new Error('Pairing timed out');
  }

  function gather(peer, abort) {
    if (peer.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise(resolve => {
      const timer = setTimeout(finish, 5500);
      function changed() {
        if (peer.iceGatheringState === 'complete') finish();
      }
      function finish() {
        clearTimeout(timer);
        peer.removeEventListener('icegatheringstatechange', changed);
        abort.removeEventListener('abort', finish);
        resolve();
      }
      peer.addEventListener('icegatheringstatechange', changed);
      abort.addEventListener('abort', finish, { once: true });
    });
  }

  function connect(events) {
    const peer = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });
    const abort = new AbortController();
    let channel, incoming, pictureBusy, timeout;
    function close() {
      clearTimeout(timeout);
      abort.abort();
      channel?.close();
      peer.close();
    }
    timeout = setTimeout(() => {
      if (peer.connectionState !== 'connected') events.status?.('เชื่อมต่อไม่สำเร็จ ลองเปิดทั้งสองเครื่องบน Wi-Fi เดียวกัน', 'error');
      if (peer.connectionState !== 'connected') close();
    }, 165000);
    peer.onconnectionstatechange = () => {
      if (abort.signal.aborted) return;
      if (peer.connectionState === 'failed') {
        events.status?.('สัญญาณระหว่างเครื่องไม่สำเร็จ ลองใช้ Wi-Fi เดียวกันแล้วเชื่อมใหม่', 'error');
        close();
      }
      if (peer.connectionState === 'disconnected') {
        events.status?.('การเชื่อมต่อขาดช่วง กำลังรอสัญญาณ', 'error');
      }
      if (peer.connectionState === 'connected') {
        clearTimeout(timeout);
        if (channel?.readyState === 'open') events.ready?.();
      }
    };
    peer.ontrack = event => {
      events.video?.(event.streams[0] || new MediaStream([event.track]));
    };

    function configureChannel(value, receivesImage) {
      channel = value;
      channel.binaryType = 'arraybuffer';
      channel.onopen = () => events.ready?.();
      channel.onclose = () => {
        if (!abort.signal.aborted) events.disconnected?.();
      };
      channel.onmessage = ({ data }) => {
        if (typeof data === 'string') {
          let message;
          try { message = JSON.parse(data); } catch { return; }
          if (!message || typeof message !== 'object') return;
          if (message.type === 'frame' && receivesImage) events.frame?.(message);
          if (message.type === 'scan-status' && receivesImage) events.scanStatus?.(message);
          if (message.type === 'scan-mode' && receivesImage) events.scanMode?.(message);
          if (message.type === 'capture' && !receivesImage) events.capture?.();
          if (message.type === 'resume' && receivesImage) events.resume?.();
          if (message.type === 'received' && !receivesImage) events.received?.();
          if (message.type === 'photo' && receivesImage &&
              Number.isInteger(message.size) && message.size > 0 && message.size <= maximumImage &&
              Number.isInteger(message.width) && message.width > 0 && message.width <= 2400 &&
              Number.isInteger(message.height) && message.height > 0 && message.height <= 2400) {
            incoming = { ...message, received: 0, parts: [] };
          }
          return;
        }
        if (!incoming || !(data instanceof ArrayBuffer)) return;
        incoming.received += data.byteLength;
        if (incoming.received > incoming.size) { incoming = null; return; }
        incoming.parts.push(data);
        if (incoming.received === incoming.size) {
          const { parts, width, height } = incoming;
          incoming = null;
          events.image?.(new Blob(parts, { type: 'image/jpeg' }), width, height);
        }
      };
    }

    function send(message) {
      if (channel?.readyState !== 'open') return false;
      try {
        channel.send(JSON.stringify(message));
        return true;
      } catch { return false; }
    }

    async function photo(blob, width, height) {
      if (pictureBusy || channel?.readyState !== 'open' || blob.size > maximumImage) return false;
      pictureBusy = true;
      try {
        const bytes = await blob.arrayBuffer();
        if (!send({ type: 'photo', size: bytes.byteLength, width, height })) return false;
        for (let i = 0; i < bytes.byteLength; i += chunkSize) {
          const deadline = Date.now() + 12000;
          while (channel.bufferedAmount > 256000) {
            if (channel.readyState !== 'open' || Date.now() > deadline) return false;
            await new Promise(resolve => setTimeout(resolve, 40));
          }
          if (channel.readyState !== 'open') return false;
          channel.send(bytes.slice(i, i + chunkSize));
        }
        return true;
      } catch { return false; }
      finally { pictureBusy = false; }
    }

    return { peer, abort, close, send, photo, configureChannel };
  }

  function host(events) {
    const secret = encode(crypto.getRandomValues(new Uint8Array(32)));
    const link = new URL(location.origin);
    link.hash = 'scan-camera=' + secret;
    const connection = connect(events);
    const { peer, abort } = connection;
    peer.addTransceiver('video', { direction: 'recvonly' });
    connection.configureChannel(peer.createDataChannel('freshy-camera'), true);
    (async () => {
      try {
        const key = await keys(secret);
        await peer.setLocalDescription(await peer.createOffer());
        await gather(peer, abort.signal);
        await signal(key, 'offer', 'POST', peer.localDescription, abort.signal);
        events.link?.(link.toString());
        const answer = await waitForSignal(key, 'answer', abort.signal);
        await peer.setRemoteDescription(answer);
        await Promise.allSettled([
          signal(key, 'offer', 'DELETE', undefined, abort.signal),
          signal(key, 'answer', 'DELETE', undefined, abort.signal)
        ]);
      } catch {
        if (abort.signal.aborted) return;
        events.status?.('เปิดการเชื่อมต่อไม่ได้ ลองสร้าง QR ใหม่', 'error');
        connection.close();
      }
    })();
    return connection;
  }

  function join(secret, stream, events) {
    const connection = connect(events);
    const { peer, abort } = connection;
    peer.ondatachannel = event => connection.configureChannel(event.channel, false);
    (async () => {
      try {
        const key = await keys(secret);
        const offer = await waitForSignal(key, 'offer', abort.signal);
        await peer.setRemoteDescription(offer);
        for (const track of stream.getVideoTracks()) peer.addTrack(track, stream);
        await peer.setLocalDescription(await peer.createAnswer());
        await gather(peer, abort.signal);
        await signal(key, 'answer', 'POST', peer.localDescription, abort.signal);
      } catch {
        if (abort.signal.aborted) return;
        events.status?.('เชื่อมต่อไม่ได้ กรุณาสแกน QR ใหม่จากคอมพิวเตอร์', 'error');
        connection.close();
      }
    })();
    return connection;
  }

  window.FreshyPair = { host, join };
})();
