(() => {
  'use strict';

  const cameraIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M4 6h4l2-2h4l2 2h4a2 2 0 0 1 2 2v11a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V8a2 2 0 0 1 2-2Z"/><circle cx="12" cy="13" r="4"/></svg>';
  const sample = document.createElement('canvas');
  const sampleContext = sample.getContext('2d', { willReadFrequently: true });
  let active;

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('freshy-document-scanner', 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('scans', { keyPath: 'id' }).createIndex('owner', 'owner');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('close other tabs'));
    });
  }

  async function records(mode, work) {
    const database = await openDatabase();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction('scans', mode);
        const request = work(transaction.objectStore('scans'));
        transaction.oncomplete = () => resolve(request.result);
        transaction.onabort = () => reject(transaction.error);
      });
    } finally {
      database.close();
    }
  }

  function label(state, message, kind = '') {
    const status = state.find('status');
    if (status.textContent !== message) status.textContent = message;
    status.dataset.kind = kind;
  }

  function stopCamera(state, keepRemote = false) {
    state.cameraAttempt++;
    clearInterval(state.timer);
    clearTimeout(state.confirmTimer);
    state.stream?.getTracks().forEach(track => track.stop());
    state.stream = null;
    state.previous = null;
    state.steadySince = 0;
    const video = state.find('video');
    video.srcObject = null;
    video.hidden = true;
    state.find('guide').hidden = true;
    if (!keepRemote && state.remote) {
      state.pair?.close();
      state.pair = null;
      state.remote = false;
      state.find('pair-toggle').hidden = false;
      state.find('pair-panel').hidden = true;
    }
    state.find('shutter').hidden = true;
    state.find('stop').hidden = true;
    state.find('start').hidden = false;
    state.find('start').disabled = state.busy;
    state.find('empty').hidden = !!state.current;
  }

  function close() {
    if (!active) return;
    active.pair?.close();
    stopCamera(active);
    if (active.imageUrl) URL.revokeObjectURL(active.imageUrl);
    active = null;
  }

  function thaiDateInput() {
    const date = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts();
    return ['year', 'month', 'day'].map(type => date.find(part => part.type === type).value).join('-');
  }

  function mount(root, user, secret = null) {
    close();
    root.innerHTML = `
      <section class="scan-page ${secret ? 'scan-phone' : ''}" aria-labelledby="scan-heading">
        <header class="scan-banner">
          ${cameraIcon}
          <div><small>FRESHY WATER <span></span> งานสารบรรณ</small>
            <h1 id="scan-heading">สแกนเอกสารด้วยกล้อง</h1>
            <p>${secret ? 'ใช้กล้องมือถือส่งภาพและกรอบไปยังหน้าจอคอมพิวเตอร์ที่จับคู่' : 'ถ่ายภาพ ตัดขอบ และตรวจเอกสารก่อนเข้าทะเบียน'}</p></div>
          <button type="button" class="scan-button scan-connect" data-scan="pair-toggle" ${secret ? 'hidden' : ''}>เชื่อมกล้องมือถือ</button>
        </header>
        <div class="scan-grid">
          <section class="scan-card" aria-labelledby="scan-camera-heading">
            <div class="scan-head"><h2 id="scan-camera-heading">ภาพจากกล้อง</h2>
              <label class="scan-auto"><input data-scan="auto" type="checkbox" checked> ถ่ายอัตโนมัติ</label></div>
            <div class="scan-pair-panel" data-scan="pair-panel" hidden>
              <canvas width="156" height="156" data-scan="qr" hidden aria-label="QR เชื่อมกล้องมือถือ"></canvas>
              <div><strong>เชื่อมกล้องมือถือกับคอมพิวเตอร์</strong>
                <p data-scan="pair-message" role="status">กำลังสร้าง QR</p>
                <div class="scan-actions">
                  <button type="button" class="scan-button" data-scan="copy" hidden>คัดลอกลิงก์</button>
                  <button type="button" class="scan-button" data-scan="pair-close">ยกเลิก</button>
                </div>
              </div>
            </div>
            <div class="scan-stage">
              <div class="scan-empty" data-scan="empty"><span class="scan-glyph">${cameraIcon}</span>
                <strong>จัดเอกสารให้ครบ 4 มุม</strong><p>วางบนพื้นเรียบ สีตัดกับกระดาษ แล้วถือโทรศัพท์ให้นิ่ง</p></div>
              <video data-scan="video" playsinline muted hidden></video>
              <canvas data-scan="guide" aria-hidden="true" hidden></canvas>
              <img data-scan="preview" alt="ตัวอย่างภาพเอกสารที่สแกน" hidden>
            </div>
            <div class="scan-crop-editor" data-scan="crop-editor" hidden>
              <p>ลากจุดทั้ง 4 ให้ตรงมุมกระดาษ หรือใช้ปุ่มลูกศรเมื่อเลือกจุด</p>
              <div class="scan-crop-surface" data-scan="crop-surface">
                <canvas data-scan="crop-canvas" aria-hidden="true"></canvas>
                ${['บนซ้าย','บนขวา','ล่างขวา','ล่างซ้าย'].map((corner, index) =>
                  `<button type="button" data-corner="${index}" aria-label="ปรับมุม${corner}"></button>`).join('')}
              </div>
              <div class="scan-actions">
                <button type="button" class="scan-button primary" data-scan="crop-apply">ตัดตามกรอบ</button>
                <button type="button" class="scan-button" data-scan="crop-cancel">ยกเลิก</button>
              </div>
            </div>
            <div class="scan-status" data-scan="status" role="status">เปิดกล้องหรือเลือกภาพเอกสารจากเครื่อง</div>
            <div class="scan-actions">
              <button class="scan-button primary" data-scan="start">${cameraIcon}<span>เปิดกล้อง</span></button>
              <button class="scan-button primary" data-scan="shutter" hidden>ถ่ายตอนนี้</button>
              <button class="scan-button" data-scan="stop" hidden>ปิดกล้อง</button>
              <button class="scan-button" data-scan="pick">เลือกภาพจากเครื่อง</button>
              <button class="scan-button" data-scan="next" hidden>สแกนหน้าถัดไป</button>
              <button class="scan-button" data-scan="crop" hidden>ปรับมุมกระดาษ</button>
              <input data-scan="file" type="file" accept="image/*" hidden ${secret ? 'capture="environment"' : ''}>
            </div>
          </section>
          <section class="scan-card" aria-labelledby="scan-details-heading">
            <h2 id="scan-details-heading">ลงทะเบียนเอกสาร</h2>
            <p class="scan-description">ตั้งชื่อและระบุตำแหน่งต้นฉบับหลังตรวจภาพ</p>
            <form data-scan="form">
              <label class="scan-field">ชื่อเอกสาร <span aria-hidden="true">*</span>
                <input name="title" required maxlength="120" placeholder="เช่น หนังสือส่งมอบงาน"></label>
              <label class="scan-field">แฟ้มหรือที่จัดเก็บต้นฉบับ
                <input name="location" maxlength="200" placeholder="เช่น ตู้ 2 / แฟ้มหนังสือรับ"></label>
              <div class="scan-fields">
                <label class="scan-field">เลขที่หนังสือ<input name="number" maxlength="80" placeholder="ถ้ามี"></label>
                <label class="scan-field">วันที่เอกสาร<input type="date" name="date"></label>
              </div>
              <button class="scan-button primary scan-submit" data-scan="save" type="submit" disabled>บันทึกเข้าทะเบียนสแกน</button>
            </form>
            <p class="scan-note">ทะเบียนเก็บในเบราว์เซอร์เครื่องที่บันทึก สามารถดาวน์โหลด JPG หรือ PDF จากรายการด้านล่าง</p>
          </section>
        </div>
        <section class="scan-card scan-register" aria-labelledby="scan-register-heading">
          <div class="scan-head"><h2 id="scan-register-heading">ทะเบียนเอกสารที่สแกน</h2></div>
          <p class="scan-description" data-scan="summary"></p>
          <ul class="scan-records" data-scan="list"></ul>
        </section>
        <details class="scan-card scan-bottom">
          <summary>โหมดทดลองสแกนจากเครื่องพิมพ์</summary>
          <p class="scan-description">แสดงข้อมูลตัวอย่างเพื่อทดสอบหน้าจอ</p>
          <button class="scan-button" type="button" data-scan="legacy">เปิดตัวอย่าง</button>
          <div id="scanResult" class="mt"></div>
        </details>
      </section>`;

    const state = {
      owner: String(user?.username || user?.id || ''), secret, cameraAttempt: 0, steadySince: 0,
      find: name => root.querySelector(`[data-scan="${name}"]`)
    };
    active = state;
    state.find('form').elements.date.value = thaiDateInput();
    state.find('form').onsubmit = event => saveRecord(state, event);
    state.find('start').onclick = () => { if (state.remote) stopCamera(state); startCamera(state); };
    state.find('stop').onclick = () => {
      if (state.secret) {
        state.pair?.close();
        state.pairReady = false;
        state.find('next').hidden = true;
      }
      stopCamera(state);
      if (state.current) showImage(state, state.current);
      label(state, 'ปิดกล้องแล้ว');
    };
    state.find('shutter').onclick = () => state.remote ? state.pair?.send({ type: 'capture' }) : takePhoto(state, false);
    state.find('next').onclick = () => {
      state.hold = false;
      state.steadySince = 0;
      state.find('next').hidden = true;
      state.find('shutter').hidden = false;
      state.pair?.send({ type: 'resume' });
      label(state, 'จัดเอกสารหน้าถัดไปในกรอบ');
    };
    state.find('pair-toggle').onclick = () => hostCamera(state);
    state.find('pair-close').onclick = () => {
      stopCamera(state);
      if (state.current) showImage(state, state.current);
      label(state, 'ปิดการเชื่อมต่อมือถือแล้ว');
    };
    state.find('crop').onclick = () => editCrop(state,
      state.cropSource || state.current?.blob, state.cropPoints);

    state.find('crop-cancel').onclick = () => dismissCrop(state);
    state.find('crop-apply').onclick = () => applyCrop(state);
    if (secret) {
      state.find('pick').hidden = true;
      state.find('next').disabled = true;
      label(state, 'เปิดกล้องเพื่ออนุญาตให้คอมพิวเตอร์ที่จับคู่เห็นภาพและกรอบ');
    }
    state.find('auto').onchange = () => { state.steadySince = 0; };
    state.find('pick').onclick = () => state.find('file').click();
    state.find('file').onchange = event => {
      const input = event.currentTarget;
      if (input.files[0]) importImage(state, input.files[0]);
      input.value = '';
    };
    state.find('legacy').onclick = () => window.doScan();
    if (!secret) refreshList(state, true);
  }

  async function refreshList(state, restore = false) {
    try {
      const items = await records('readonly', store => store.index('owner').getAll(state.owner));
      if (active !== state) return;
      items.sort((a, b) => b.updatedAt - a.updatedAt);
      if (restore && !state.current && !state.stream && !state.busy) {
        const draft = items.find(item => !item.title);
        if (draft) {
          showImage(state, draft, true);
          label(state, 'เปิดฉบับร่างล่าสุดแล้ว กรุณาตั้งชื่อเอกสาร', 'good');
        }
      }
      state.find('summary').textContent = items.length
        ? items.length + ' รายการในเบราว์เซอร์นี้'
        : 'ยังไม่มีรายการ ภาพแรกจะแสดงที่นี่หลังสแกน';
      const list = state.find('list');
      list.replaceChildren();
      for (const item of items) {
        const row = document.createElement('li');
        row.className = 'scan-row';
        const info = document.createElement('div');
        info.className = 'scan-record-main';
        const title = document.createElement('b');
        title.textContent = item.title || 'ฉบับร่าง · รอตั้งชื่อ';
        const details = document.createElement('span');
        details.textContent = [item.number, item.location, item.date,
          new Date(item.createdAt).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })].filter(Boolean).join(' · ');
        info.append(title, details);
        const buttons = document.createElement('div');
        buttons.className = 'scan-actions';
        buttons.append(
          button(item.title ? 'เปิด / แก้ไข' : 'เปิดฉบับร่าง', () => {
            if (!state.busy) showImage(state, item, true);
          }),
          button('ภาพ JPG', () => download(item.blob, filename(item) + '.jpg')),
          button('PDF', () => downloadPdf(state, item)),
          button('ลบ', () => removeRecord(state, item))
        );
        row.append(info, buttons);
        list.append(row);
      }
    } catch {
      if (active === state) state.find('summary').textContent = 'เปิดทะเบียนในเบราว์เซอร์นี้ไม่ได้';
    }
  }

  function button(text, action) {
    const element = document.createElement('button');
    element.className = 'scan-button';
    element.type = 'button';
    element.textContent = text;
    element.onclick = action;
    return element;
  }

  function showImage(state, item, populate = false, keepRemote = false) {
    stopCamera(state, keepRemote);
    dismissCrop(state);
    if (state.current?.id !== item.id) {
      state.cropSource = null;
      state.cropPoints = null;
    }
    state.current = item;
    if (state.imageUrl) URL.revokeObjectURL(state.imageUrl);
    state.imageUrl = URL.createObjectURL(item.blob);
    const preview = state.find('preview');
    preview.src = state.imageUrl;
    preview.hidden = false;
    state.find('empty').hidden = true;
    state.find('start').querySelector('span').textContent = 'ถ่ายภาพใหม่';
    state.find('save').disabled = state.busy;
    state.find('crop').hidden = !!state.secret;
    if (populate) {
      const fields = state.find('form').elements;
      fields.title.value = item.title || '';
      fields.location.value = item.location || '';
      fields.number.value = item.number || '';
      fields.date.value = item.date || thaiDateInput();
      label(state, item.title ? 'เปิดภาพและข้อมูลเอกสารแล้ว' : 'เปิดฉบับร่างแล้ว กรุณาตั้งชื่อเอกสาร', 'good');
    }
  }

  function setBusy(state, busy) {
    state.busy = busy;
    state.find('start').disabled = busy;
    state.find('pick').disabled = busy;
    state.find('save').disabled = busy || !state.current;
    state.find('shutter').disabled = busy;
    state.find('next').disabled = busy;
    state.find('crop').disabled = busy;
    state.find('crop-apply').disabled = busy;
  }

  async function removeRecord(state, item) {
    if (state.busy || !window.confirm('ลบภาพและข้อมูลรายการนี้ออกจากเครื่อง?')) return;
    setBusy(state, true);
    try {
      await records('readwrite', store => store.delete(item.id));
      if (active !== state) return;
      if (state.current?.id === item.id) {
        state.current = null;
        URL.revokeObjectURL(state.imageUrl);
        state.imageUrl = null;
        state.find('preview').removeAttribute('src');
        state.find('preview').hidden = true;
        state.find('empty').hidden = !!state.stream;
        state.find('form').reset();
        state.find('form').elements.date.value = thaiDateInput();
        state.find('start').querySelector('span').textContent = 'เปิดกล้อง';
      }
      label(state, 'ลบรายการออกจากเครื่องแล้ว');
      await refreshList(state);
    } catch {
      if (active === state) label(state, 'ลบรายการไม่ได้ กรุณาลองอีกครั้ง', 'error');
    } finally {
      if (active === state) setBusy(state, false);
    }
  }

  async function saveRecord(state, event) {
    event.preventDefault();
    if (!state.current || state.busy) return;
    const fields = event.currentTarget.elements;
    const title = fields.title.value.trim();
    if (!title) {
      fields.title.focus();
      label(state, 'กรุณากรอกชื่อเอกสาร', 'error');
      return;
    }
    const entry = {
      ...state.current, title, location: fields.location.value.trim(),
      number: fields.number.value.trim(), date: fields.date.value, updatedAt: Date.now()
    };
    setBusy(state, true);
    try {
      await records('readwrite', store => store.put(entry));
      if (active !== state) return;
      state.current = entry;
      label(state, 'บันทึกเข้าทะเบียนสแกนบนเครื่องนี้แล้ว', 'good');
      await refreshList(state);
    } catch {
      if (active === state) label(state, 'บันทึกทะเบียนไม่ได้ ภาพยังอยู่ในหน้าจอนี้', 'error');
    } finally {
      if (active === state) setBusy(state, false);
    }
  }

  function filename(item) {
    return (item.title || 'เอกสารสแกน').replace(/[\\/:*?"<>|\x00-\x1f]/g, '-').trim();
  }

  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  async function downloadPdf(state, item) {
    try {
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ unit: 'pt', format: 'a4', orientation: item.width > item.height ? 'landscape' : 'portrait' });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const scale = Math.min((pageWidth - 36) / item.width, (pageHeight - 36) / item.height);
      const width = item.width * scale;
      const height = item.height * scale;
      pdf.addImage(new Uint8Array(await item.blob.arrayBuffer()), 'JPEG',
        (pageWidth - width) / 2, (pageHeight - height) / 2, width, height);
      pdf.save(filename(item) + '.pdf');
    } catch {
      if (active === state) label(state, 'สร้าง PDF ไม่สำเร็จ กรุณาลองใหม่หรือดาวน์โหลดภาพ JPG', 'error');
    }
  }

  function jpeg(canvas) {
    return new Promise((resolve, reject) => canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error('image encoding failed')), 'image/jpeg', .93
    ));
  }

  async function storeImage(state, canvas) {
    return storeBlob(state, await jpeg(canvas), canvas.width, canvas.height);
  }

  async function storeBlob(state, blob, width, height, replacement = null) {
    if (active !== state) return;
    const time = Date.now();
    const entry = { ...(replacement || { id: crypto.randomUUID(), owner: state.owner, createdAt: time }),
      blob, width, height, updatedAt: time };
    if (state.secret) {
      state.hold = true;
      state.find('shutter').hidden = true;
      state.find('next').hidden = true;
      label(state, 'กำลังส่งภาพที่ตัดขอบให้คอมพิวเตอร์');
      const sent = await state.pair?.photo(blob, width, height);
      if (sent) {
        clearTimeout(state.confirmTimer);
        state.confirmTimer = setTimeout(() => {
          if (active === state && state.hold && state.find('next').hidden) {
            state.find('next').hidden = false;
            label(state, 'ยังไม่ได้รับการยืนยัน กรุณาตรวจภาพที่คอมพิวเตอร์ก่อนสแกนต่อ', 'error');
          }
        }, 12000);
      }
      if (active === state && !sent) {
        state.find('next').hidden = true;
        label(state, 'ส่งภาพไม่สำเร็จ กรุณาเชื่อมกล้องใหม่', 'error');
      }
      return;
    }
    try {
      await records('readwrite', store => replacement ? store.put(entry) : store.add(entry));
    } catch {
      if (active !== state) return;
      showImage(state, entry, true, true);
      label(state, 'เก็บฉบับร่างไม่ได้ ภาพยังอยู่ในหน้านี้ กดบันทึกเพื่อลองอีกครั้ง', 'error');
      return;
    }
    if (active !== state) return;
    showImage(state, entry, true, true);
    label(state, replacement ? 'ปรับขอบและบันทึกภาพแล้ว' : 'เก็บภาพที่ตัดขอบเป็นฉบับร่างแล้ว กรุณาตั้งชื่อเอกสาร', 'good');
    await refreshList(state);
    return true;
  }

  function canvasFrom(source, width, height) {
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 2200 / Math.max(width, height));
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  async function importImage(state, file) {
    if (state.busy) return;
    setBusy(state, true);
    stopCamera(state);
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = reject;
        image.src = url;
      });
      const raw = canvasFrom(image, image.naturalWidth, image.naturalHeight);
      const frame = inspectFrame(raw, raw.width, raw.height);
      if (!frame.points) {
        editCrop(state, file, null, true);
        return;
      }
      await storeImage(state, cropPaper(raw, frame));
      state.cropSource = file;
      state.cropPoints = normalizeCorners(frame);
    } catch {
      if (active === state) {
        if (state.current) showImage(state, state.current);
        label(state, 'เปิดหรือบันทึกภาพนี้ไม่ได้ กรุณาเลือกภาพ JPG หรือ PNG', 'error');
      }
    } finally {
      URL.revokeObjectURL(url);
      if (active === state) setBusy(state, false);
    }
  }

  async function startCamera(state) {
    if (state.busy) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      label(state, 'กล้องต้องเปิดผ่าน HTTPS และเบราว์เซอร์ที่รองรับ หรือเลือกภาพจากเครื่อง', 'error');
      return;
    }
    dismissCrop(state);
    state.find('crop').hidden = true;
    const attempt = ++state.cameraAttempt;
    const start = state.find('start');
    start.disabled = true;
    state.find('stop').hidden = false;
    label(state, 'กำลังขอสิทธิ์ใช้งานกล้อง');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false, video: { facingMode: { ideal: 'environment' },
          width: { ideal: 1920 }, height: { ideal: 1440 } }
      });
      if (active !== state || attempt !== state.cameraAttempt) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      state.stream = stream;
      const video = state.find('video');
      video.srcObject = stream;
      state.find('preview').hidden = true;
      state.find('empty').hidden = true;
      video.hidden = false;
      await video.play();
      if (active !== state || attempt !== state.cameraAttempt) return;
      state.find('guide').hidden = false;
      state.find('shutter').hidden = !!state.secret;
      start.hidden = true;
      if (state.secret) {
        state.hold = false;
        state.pairReady = false;
        state.pair?.close();
        state.pair = window.FreshyPair.join(state.secret, stream, {
          ready: () => {
            if (active !== state || !state.stream) return;
            state.pairReady = true;
            state.find('shutter').hidden = false;
            label(state, 'เชื่อมกับคอมพิวเตอร์แล้ว จัดกระดาษให้ครบสี่มุม', 'good');
          },
          received: () => {
            if (active !== state) return;
            state.find('next').hidden = false;
            label(state, 'คอมพิวเตอร์เก็บภาพเป็นฉบับร่างแล้ว', 'good');
          },
          capture: () => takePhoto(state, false),
          status: (message, kind) => {
            if (active !== state) return;
            stopCamera(state);
            state.pairReady = false;
            label(state, message, kind);
          },
          disconnected: () => {
            if (active !== state) return;
            stopCamera(state);
            state.pairReady = false;
            label(state, 'คอมพิวเตอร์ปิดการเชื่อมต่อแล้ว');
          }
        });
      }
      stream.getVideoTracks()[0].addEventListener('ended', () => {
        if (active === state && attempt === state.cameraAttempt) {
          stopCamera(state);
          if (state.current) showImage(state, state.current);
          label(state, 'กล้องหยุดทำงาน กรุณาเปิดกล้องอีกครั้ง', 'error');
        }
      });
      label(state, state.secret ? 'กำลังเชื่อมกับคอมพิวเตอร์' : 'จัดเอกสารให้เห็นครบทั้ง 4 มุม');
      state.timer = setInterval(() => checkFrame(state), 175);
    } catch (error) {
      if (active !== state || attempt !== state.cameraAttempt) return;
      stopCamera(state);
      if (state.current) showImage(state, state.current);
      label(state, error.name === 'NotAllowedError'
        ? 'ยังไม่ได้รับสิทธิ์กล้อง กรุณาอนุญาตในเบราว์เซอร์หรือเลือกภาพจากเครื่อง'
        : 'เปิดกล้องไม่ได้ กรุณาตรวจสอบกล้องหรือเลือกภาพจากเครื่อง', 'error');
    }
  }

  function hostCamera(state) {
    if (state.busy) return;
    stopCamera(state);
    dismissCrop(state);
    const panel = state.find('pair-panel');
    const message = state.find('pair-message');
    const qr = state.find('qr');
    const copy = state.find('copy');
    panel.hidden = false;
    qr.hidden = true;
    copy.hidden = true;
    message.textContent = 'กำลังสร้างรหัสเชื่อมต่อ';
    state.find('pair-close').textContent = 'ยกเลิก';
    state.find('pair-toggle').hidden = true;
    state.remote = true;
    let stream;
    const showRemote = async () => {
      if (!stream || active !== state || !state.remote) return;
      dismissCrop(state);
      const video = state.find('video');
      video.srcObject = stream;
      state.find('preview').hidden = true;
      state.find('empty').hidden = true;
      video.hidden = false;
      state.find('guide').hidden = true;
      state.find('crop').hidden = true;
      state.find('start').hidden = true;
      state.find('shutter').hidden = false;
      try { await video.play(); }
      catch { if (active === state) label(state, 'เปิดภาพกล้องไม่ได้ กรุณาเชื่อมใหม่', 'error'); }
    };
    try {
      state.pair = window.FreshyPair.host({
        link: async link => {
          if (active !== state || !state.remote) return;
          message.textContent = 'สแกน QR ด้วยมือถือ แล้วกดเปิดกล้อง · ลิงก์มีอายุประมาณ 3 นาที';
          copy.hidden = false;
          copy.onclick = async () => {
            try {
              await navigator.clipboard.writeText(link);
              message.textContent = 'คัดลอกลิงก์แล้ว เปิดลิงก์บนมือถือที่ต้องการใช้เป็นกล้อง';
            } catch {
              message.textContent = 'คัดลอกลิงก์ไม่ได้ กรุณาสแกน QR ด้วยกล้องมือถือ';
            }
          };
          try {
            await window.FreshyQR.toCanvas(qr, link, { width: 156, margin: 2, errorCorrectionLevel: 'M' });
            if (active === state && state.remote) qr.hidden = false;
          } catch {
            if (active === state && state.remote) message.textContent = 'สร้างภาพ QR ไม่ได้ ใช้ปุ่มคัดลอกลิงก์ได้';
          }
        },
        ready: () => {
          if (active !== state || !state.remote) return;
          qr.hidden = true;
          copy.hidden = true;
          state.find('pair-close').textContent = 'ตัดการเชื่อมต่อ';
          message.textContent = 'เชื่อมกล้องมือถือแล้ว สามารถดูกรอบและกดถ่ายจากคอมพิวเตอร์';
        },
        video: live => { stream = live; showRemote(); },
        frame: data => {
          if (active !== state || !state.remote || state.find('video').hidden) return;
          const { width, height, points, ready, message } = data;
          if (!Number.isInteger(width) || width < 1 || width > 320 ||
              !Number.isInteger(height) || height < 1 || height > 320) return;
          if (points && (!Array.isArray(points) || points.length !== 4 || !points.every(point =>
            point && Number.isFinite(point.x) && Number.isFinite(point.y) &&
            point.x >= 0 && point.x <= width && point.y >= 0 && point.y <= height))) return;
          const guide = state.find('guide');
          drawGuide(guide, { width, height, points }, ready);
          guide.hidden = false;
          if (typeof message === 'string') label(state, message.slice(0, 120), ready ? 'good' : '');
        },
        resume: showRemote,
        image: async (blob, width, height) => {
          if (active !== state || !state.remote) return;
          let processing = false;
          try {
            const bitmap = await createImageBitmap(blob);
            const valid = bitmap.width === width && bitmap.height === height;
            bitmap.close();
            if (!valid || active !== state || !state.remote || state.busy) return;
            processing = true;
            setBusy(state, true);
            const saved = await storeBlob(state, blob, width, height);
            if (saved && active === state) state.pair?.send({ type: 'received' });
            if (active === state) state.find('start').hidden = true;
          } catch {
            if (active === state) label(state, 'เปิดภาพที่ส่งมาจากมือถือไม่ได้', 'error');
          } finally {
            if (active === state && processing) setBusy(state, false);
          }
        },
        status: (text, kind) => {
          if (active !== state || !state.remote) return;
          label(state, text, kind);
          message.textContent = text;
        },
        disconnected: () => {
          if (active !== state || !state.remote) return;
          stopCamera(state);
          if (state.current) showImage(state, state.current);
          label(state, 'มือถือปิดการเชื่อมต่อแล้ว');
        }
      });
    } catch {
      stopCamera(state);
      label(state, 'เบราว์เซอร์นี้เปิดการเชื่อมกล้องไม่ได้', 'error');
    }
  }

  function inspectFrame(source, sourceWidth = source.videoWidth, sourceHeight = source.videoHeight) {
    const scale = 320 / Math.max(sourceWidth, sourceHeight);
    const width = Math.round(sourceWidth * scale);
    const height = Math.round(sourceHeight * scale);
    if (sample.width !== width || sample.height !== height) {
      sample.width = width;
      sample.height = height;
    }
    sampleContext.drawImage(source, 0, 0, width, height);
    const rgba = sampleContext.getImageData(0, 0, width, height).data;
    const gray = new Uint8Array(width * height);
    const histogram = new Uint32Array(256);
    let total = 0;
    for (let i = 0; i < gray.length; i++) {
      const offset = i * 4;
      const value = (77 * rgba[offset] + 150 * rgba[offset + 1] + 29 * rgba[offset + 2]) >> 8;
      gray[i] = value;
      histogram[value]++;
      total += value;
    }
    let leftCount = 0, leftSum = 0, maxVariance = 0, threshold = 0;
    for (let value = 0; value < 255; value++) {
      leftCount += histogram[value];
      leftSum += value * histogram[value];
      const rightCount = gray.length - leftCount;
      if (!leftCount || !rightCount) continue;
      const difference = leftSum / leftCount - (total - leftSum) / rightCount;
      const variance = leftCount * rightCount * difference ** 2;
      if (variance > maxVariance) {
        maxVariance = variance;
        threshold = value;
      }
    }
    const mean = total / gray.length;
    if (mean < 38) return { gray, width, height, issue: 'แสงน้อย กรุณาเพิ่มแสงให้ทั่วเอกสาร' };
    if (Math.sqrt(maxVariance) / gray.length < 13) return { gray, width, height };

    const points = findPaper(gray, width, height, threshold);
    if (!points) return { gray, width, height };
    return { gray, width, height, points, issue: paperQuality(gray, width, height, points) };
  }

  function findPaper(gray, width, height, threshold) {
    const seen = new Uint8Array(gray.length);
    const queue = new Int32Array(gray.length);
    let best = null, bestSize = gray.length * .13;
    for (let i = 0; i < gray.length; i++) {
      if (seen[i] || gray[i] <= threshold) continue;
      let count = 1;
      let touchesEdge = false;
      const extremes = [-Infinity, -Infinity, -Infinity, -Infinity];
      const points = [];
      queue[0] = i;
      seen[i] = 1;
      for (let head = 0; head < count; head++) {
        const index = queue[head];
        const x = index % width;
        const y = Math.floor(index / width);
        if (x < 2 || x > width - 3 || y < 2 || y > height - 3) touchesEdge = true;
        const scores = [-x - y, x - y, x + y, y - x];
        for (let k = 0; k < scores.length; k++) {
          if (scores[k] > extremes[k]) {
            extremes[k] = scores[k];
            points[k] = { x, y };
          }
        }
        if (x > 0) visit(index - 1);
        if (x < width - 1) visit(index + 1);
        if (y > 0) visit(index - width);
        if (y < height - 1) visit(index + width);
      }
      if (touchesEdge || count <= bestSize) continue;
      const sides = points.map((p, k) => distance(p, points[(k + 1) % 4]));
      const area = points.reduce((sum, p, k) => {
        const next = points[(k + 1) % 4];
        return sum + p.x * next.y - p.y * next.x;
      }, 0) / 2;
      if (area < gray.length * .15 || Math.min(...sides) < Math.min(width, height) * .23 ||
          count / area < .62 || count / area > 1.2 ||
          Math.min(sides[0], sides[2]) / Math.max(sides[0], sides[2]) < .57 ||
          Math.min(sides[1], sides[3]) / Math.max(sides[1], sides[3]) < .57 ||
          !hasFourEdges(gray, width, height, threshold, points)) continue;
      best = points;
      bestSize = count;

      function visit(index) {
        if (seen[index] || gray[index] <= threshold) return;
        seen[index] = 1;
        queue[count++] = index;
      }
    }
    return best;
  }

  function hasFourEdges(gray, width, height, threshold, points) {
    const read = (x, y) => gray[Math.round(y) * width + Math.round(x)];
    return points.every((a, index) => {
      const b = points[(index + 1) % 4];
      const side = distance(a, b);
      const normalX = (a.y - b.y) * 4 / side;
      const normalY = (b.x - a.x) * 4 / side;
      let passes = 0;
      for (const t of [.15, .27, .39, .5, .61, .73, .85]) {
        const x = a.x + (b.x - a.x) * t;
        const y = a.y + (b.y - a.y) * t;
        if (x < 4 || x > width - 5 || y < 4 || y > height - 5) continue;
        const inside = read(x + normalX, y + normalY);
        const outside = read(x - normalX, y - normalY);
        if (inside > threshold && outside <= threshold && inside - outside >= 20) passes++;
      }
      return passes >= 5;
    });
  }

  function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function paperQuality(gray, width, height, points) {
    const center = points.reduce((sum, point) => ({
      x: sum.x + point.x / 4, y: sum.y + point.y / 4
    }), { x: 0, y: 0 });
    const interior = points.map(point => ({
      x: center.x + (point.x - center.x) * .83, y: center.y + (point.y - center.y) * .83
    }));
    let samples = 0, light = 0, sharp = 0;
    for (let y = 2; y < height - 2; y += 2) {
      for (let x = 2; x < width - 2; x += 2) {
        if (!interior.every((a, i) => {
          const b = interior[(i + 1) % 4];
          return (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x) >= 0;
        })) continue;
        const i = y * width + x;
        samples++;
        light += gray[i];
        const laplacian = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - width] - gray[i + width];
        sharp += Math.min(120, Math.abs(laplacian)) ** 2;
      }
    }
    if (light / samples < 112) return 'เอกสารมืดเกินไป กรุณาเพิ่มแสง';
    if (sharp / samples < 42) return 'ภาพยังไม่ชัด ลองรอให้กล้องโฟกัสหรือขยับเข้าใกล้';
    return '';
  }

  function drawGuide(canvas, frame, ready) {
    const { width, height, points } = frame;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, width, height);
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = ready ? '#56e9a8' : '#b4d9f6';
    const bounds = points || [{x:width*.1,y:height*.08},{x:width*.9,y:height*.08},
      {x:width*.9,y:height*.92},{x:width*.1,y:height*.92}];
    ctx.beginPath();
    ctx.rect(0, 0, width, height);
    bounds.forEach((p, i) => ctx[i ? 'lineTo' : 'moveTo'](p.x, p.y));
    ctx.closePath();
    ctx.fillStyle = 'rgba(9,22,42,.3)';
    ctx.fill('evenodd');
    ctx.beginPath();
    bounds.forEach((p, i) => ctx[i ? 'lineTo' : 'moveTo'](p.x, p.y));
    ctx.closePath();
    ctx.setLineDash(points ? [] : [4, 3]);
    ctx.stroke();
  }

  function checkFrame(state) {
    const video = state.find('video');
    if (state.busy || state.hold || (state.secret && !state.pairReady) ||
        video.readyState < 2 || document.hidden) return;
    const frame = inspectFrame(video);
    const previous = state.previous;
    state.previous = frame;
    const ready = frame.points && !frame.issue;
    drawGuide(state.find('guide'), frame, ready);
    const message = !ready ? frame.issue || 'จัดเอกสารให้ครบ 4 มุม'
      : state.find('auto').checked ? 'ภาพชัดแล้ว กรุณาถือโทรศัพท์ให้นิ่ง' : 'ภาพชัดแล้ว กดถ่ายตอนนี้ได้';
    if (state.secret) state.pair?.send({
      type: 'frame', width: frame.width, height: frame.height, points: frame.points, ready: !!ready, message
    });
    if (!ready) {
      state.steadySince = 0;
      label(state, frame.issue || 'จัดเอกสารให้เห็นครบทั้ง 4 มุมและใช้พื้นหลังตัดกับกระดาษ');
      return;
    }
    const stable = previous?.points && previous.width === frame.width && previous.height === frame.height &&
      frame.points.every((point, i) => distance(point, previous.points[i]) < 4);
    let motion = 0;
    if (stable) {
      for (let i = 0; i < frame.gray.length; i += 11) motion += Math.abs(frame.gray[i] - previous.gray[i]);
      motion /= Math.ceil(frame.gray.length / 11);
    }
    const now = performance.now();
    if (!stable || motion > 4.8 || now - state.lastSample > 500) state.steadySince = 0;
    state.lastSample = now;
    if (!state.find('auto').checked) {
      label(state, 'ภาพชัดแล้ว กดถ่ายตอนนี้ได้', 'good');
      return;
    }
    if (!state.steadySince) state.steadySince = now;
    label(state, 'ภาพชัดแล้ว กรุณาถือโทรศัพท์ให้นิ่ง', 'good');
    if (now - state.steadySince >= 700) takePhoto(state, true);
  }

  function normalizeCorners(frame) {
    return frame?.points?.map(point => ({ x: point.x / frame.width, y: point.y / frame.height }));
  }

  function cropPaper(source, frame) {
    const corners = normalizeCorners(frame);
    const center = corners.reduce((sum, p) => ({ x: sum.x + p.x / 4, y: sum.y + p.y / 4 }), { x: 0, y: 0 });
    return warpPaper(source, corners.map(p => ({
      x: p.x + (center.x - p.x) * .025, y: p.y + (center.y - p.y) * .025
    })));
  }

  function warpPaper(source, corners) {
    const points = corners.map(p => ({ x: p.x * (source.width - 1), y: p.y * (source.height - 1) }));
    if (points.some((a, i) => {
      const b = points[(i + 1) % 4], c = points[(i + 2) % 4];
      return distance(a, b) < 20 || (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) <= 0;
    })) throw new Error('Invalid corners');
    const [a, b, c, d] = points;
    const outputWidth = Math.round(Math.max(distance(a, b), distance(d, c)));
    const outputHeight = Math.round(Math.max(distance(a, d), distance(b, c)));
    const scale = Math.min(1, 2200 / Math.max(outputWidth, outputHeight));
    const output = document.createElement('canvas');
    const width = output.width = Math.round(outputWidth * scale);
    const height = output.height = Math.round(outputHeight * scale);
    const input = source.getContext('2d').getImageData(0, 0, source.width, source.height).data;
    const context = output.getContext('2d');
    const result = context.createImageData(width, height);
    const dx1 = b.x - c.x, dx2 = d.x - c.x, dx3 = a.x - b.x + c.x - d.x;
    const dy1 = b.y - c.y, dy2 = d.y - c.y, dy3 = a.y - b.y + c.y - d.y;
    const determinant = dx1 * dy2 - dx2 * dy1;
    if (Math.abs(determinant) < .001) throw new Error('Invalid perspective');
    const g = (dx3 * dy2 - dx2 * dy3) / determinant;
    const h = (dx1 * dy3 - dx3 * dy1) / determinant;
    for (let y = 0; y < height; y++) {
      const v = (y + .5) / height;
      for (let x = 0; x < width; x++) {
        const u = (x + .5) / width;
        const divisor = 1 + g * u + h * v;
        const sx = Math.max(0, Math.min(source.width - 1.001,
          (a.x + (b.x * (1 + g) - a.x) * u + (d.x * (1 + h) - a.x) * v) / divisor));
        const sy = Math.max(0, Math.min(source.height - 1.001,
          (a.y + (b.y * (1 + g) - a.y) * u + (d.y * (1 + h) - a.y) * v) / divisor));
        const dx = sx % 1, dy = sy % 1;
        const from = (Math.floor(sy) * source.width + Math.floor(sx)) * 4;
        const next = from + source.width * 4;
        const to = (y * width + x) * 4;
        for (let i = 0; i < 3; i++) {
          result.data[to + i] = (input[from + i] * (1 - dx) + input[from + 4 + i] * dx) * (1 - dy) +
            (input[next + i] * (1 - dx) + input[next + 4 + i] * dx) * dy;
        }
        result.data[to + 3] = 255;
      }
    }
    context.putImageData(result, 0, 0);
    return output;
  }

  function dismissCrop(state) {
    state.editor = null;
    state.find('crop-editor').hidden = true;
  }

  async function editCrop(state, blob, points = state.cropPoints, fresh = false) {
    if (!blob) return;
    stopCamera(state, true);
    const url = URL.createObjectURL(blob);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      if (active !== state) return;
      const raw = canvasFrom(image, image.naturalWidth, image.naturalHeight);
      const canvas = state.find('crop-canvas');
      const surface = state.find('crop-surface');
      const aspect = raw.width / raw.height;
      surface.style.width = 'min(100%, ' + Math.round(435 * aspect) + 'px)';
      surface.style.aspectRatio = raw.width + ' / ' + raw.height;
      canvas.width = raw.width;
      canvas.height = raw.height;
      const corners = points?.map(p => ({ ...p })) ||
        [{x:.035,y:.035},{x:.965,y:.035},{x:.965,y:.965},{x:.035,y:.965}];
      state.editor = { raw, corners, blob, replacement: fresh ? null : state.current };
      const handles = Array.from(surface.querySelectorAll('[data-corner]'));
      const redraw = () => {
        const ctx = canvas.getContext('2d');
        ctx.drawImage(raw, 0, 0);
        ctx.beginPath();
        ctx.rect(0, 0, raw.width, raw.height);
        corners.forEach(({ x, y }, i) => {
          ctx[i ? 'lineTo' : 'moveTo'](x * raw.width, y * raw.height);
          handles[i].style.left = x * 100 + '%';
          handles[i].style.top = y * 100 + '%';
        });
        ctx.closePath();
        ctx.fillStyle = 'rgba(6,22,45,.58)';
        ctx.fill('evenodd');
      };
      handles.forEach((handle, index) => {
        const move = (x, y) => {
          corners[index] = { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
          redraw();
        };
        handle.onpointerdown = event => handle.setPointerCapture(event.pointerId);
        handle.onpointermove = event => {
          if (!handle.hasPointerCapture(event.pointerId)) return;
          const bounds = surface.getBoundingClientRect();
          move((event.clientX - bounds.left) / bounds.width, (event.clientY - bounds.top) / bounds.height);
        };
        handle.onkeydown = event => {
          const movement = { ArrowLeft: [-1,0], ArrowRight: [1,0], ArrowUp: [0,-1], ArrowDown: [0,1] }[event.key];
          if (!movement) return;
          event.preventDefault();
          const speed = event.shiftKey ? .02 : .005;
          move(corners[index].x + movement[0] * speed, corners[index].y + movement[1] * speed);
        };
      });
      state.find('crop-editor').hidden = false;
      redraw();
      label(state, 'ตรวจตำแหน่งมุมกระดาษก่อนตัดขอบ');
    } catch {
      if (active === state) label(state, 'เปิดภาพสำหรับปรับมุมไม่ได้', 'error');
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function applyCrop(state) {
    if (!state.editor || state.busy) return;
    const { raw, corners, blob, replacement } = state.editor;
    setBusy(state, true);
    try {
      const output = warpPaper(raw, corners);
      await storeBlob(state, await jpeg(output), output.width, output.height, replacement);
      state.cropSource = blob;
      state.cropPoints = corners;
    } catch {
      if (active === state) label(state, 'ปรับจุดทั้งสี่ให้เรียงตามมุมกระดาษแล้วลองอีกครั้ง', 'error');
    } finally {
      if (active === state) setBusy(state, false);
    }
  }

  async function takePhoto(state, automatic) {
    const video = state.find('video');
    if (state.busy || state.hold || !state.stream || video.readyState < 2) return;
    if (state.secret && !state.pairReady) return;
    setBusy(state, true);
    try {
      const raw = canvasFrom(video, video.videoWidth, video.videoHeight);
      const frame = inspectFrame(raw, raw.width, raw.height);
      if (automatic && (!frame.points || frame.issue)) {
        state.steadySince = 0;
        return;
      }
      if (!state.secret) stopCamera(state, true);
      label(state, 'กำลังตัดขอบกระดาษ');
      if (!frame.points) {
        if (state.secret) {
          label(state, 'ยังเห็นขอบไม่ครบ กรุณาขยับโทรศัพท์ให้เห็นกระดาษทั้งแผ่น', 'error');
          return;
        }
        await editCrop(state, await jpeg(raw), null, true);
        return;
      }
      await storeImage(state, cropPaper(raw, frame));
      if (!state.secret) {
        state.cropSource = await jpeg(raw);
        state.cropPoints = normalizeCorners(frame);
      }
    } catch {
      if (!state.secret) stopCamera(state, true);
      if (active === state) label(state, 'บันทึกภาพไม่ได้ กรุณาลองถ่ายอีกครั้ง', 'error');
    } finally {
      if (active === state) setBusy(state, false);
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && active) {
      active.steadySince = 0;
      active.previous = null;
    }
  });
  window.addEventListener('pagehide', close);
  window.FreshyScanner = { mount, close };
  const cameraLink = location.hash.match(/^#scan-camera=([A-Za-z0-9_-]{43})$/);
  if (cameraLink) {
    history.replaceState(null, '', location.pathname + location.search);
    const wrapper = document.createElement('main');
    wrapper.id = 'scan-phone-root';
    document.body.append(wrapper);
    document.body.classList.add('scan-phone-mode');
    mount(wrapper, null, cameraLink[1]);
  }
})();
