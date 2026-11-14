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

  function stopCamera(state) {
    state.cameraAttempt++;
    clearInterval(state.timer);
    state.stream?.getTracks().forEach(track => track.stop());
    state.stream = null;
    state.previous = null;
    state.steadySince = 0;
    const video = state.find('video');
    video.srcObject = null;
    video.hidden = true;
    state.find('guide').hidden = true;
    state.find('shutter').hidden = true;
    state.find('stop').hidden = true;
    state.find('start').hidden = false;
    state.find('start').disabled = state.busy;
    state.find('empty').hidden = !!state.current;
  }

  function close() {
    if (!active) return;
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

  function mount(root, user) {
    close();
    root.innerHTML = `
      <section class="scan-page" aria-labelledby="scan-heading">
        <header class="scan-banner">
          ${cameraIcon}
          <div><small>โรงน้ำดื่ม เฟรชชี่ วอเตอร์ · งานสารบรรณ</small>
            <h1 id="scan-heading">สแกนเอกสารด้วยกล้อง</h1>
            <p>วางเอกสารบนพื้นเรียบ แล้วถือโทรศัพท์เหนือเอกสารให้เห็นครบทั้ง 4 มุม</p></div>
        </header>
        <div class="scan-grid">
          <section class="scan-card" aria-labelledby="scan-camera-heading">
            <div class="scan-head"><h2 id="scan-camera-heading">กล้องและภาพเอกสาร</h2>
              <label class="scan-auto"><input data-scan="auto" type="checkbox" checked> ถ่ายอัตโนมัติ</label></div>
            <div class="scan-stage">
              <div class="scan-empty" data-scan="empty"><span class="scan-glyph">${cameraIcon}</span>
                <strong>พร้อมสแกนเอกสาร</strong><p>ใช้พื้นหลังสีเข้มและจัดแสงให้ทั่วแผ่น</p></div>
              <video data-scan="video" playsinline muted hidden></video>
              <canvas data-scan="guide" aria-hidden="true" hidden></canvas>
              <img data-scan="preview" alt="ตัวอย่างภาพเอกสารที่สแกน" hidden>
            </div>
            <div class="scan-status" data-scan="status" role="status">เปิดกล้องหรือเลือกภาพเอกสารจากเครื่อง</div>
            <div class="scan-actions">
              <button class="scan-button primary" data-scan="start">${cameraIcon}<span>เปิดกล้อง</span></button>
              <button class="scan-button primary" data-scan="shutter" hidden>ถ่ายตอนนี้</button>
              <button class="scan-button" data-scan="stop" hidden>ปิดกล้อง</button>
              <button class="scan-button" data-scan="pick">เลือกภาพจากเครื่อง</button>
              <input data-scan="file" type="file" accept="image/*" hidden>
            </div>
          </section>
          <section class="scan-card" aria-labelledby="scan-details-heading">
            <h2 id="scan-details-heading">ข้อมูลและที่จัดเก็บ</h2>
            <p class="scan-description">ภาพถ่ายจะถูกเก็บเป็นฉบับร่างทันที แล้วจึงตั้งชื่อและลงทะเบียนได้</p>
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
            <p class="scan-note">ภาพและทะเบียนสแกนเก็บในเบราว์เซอร์นี้ ข้อมูลอาจหายเมื่อล้างข้อมูลเว็บไซต์</p>
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
      owner: String(user.username || user.id), cameraAttempt: 0, steadySince: 0,
      find: name => root.querySelector(`[data-scan="${name}"]`)
    };
    active = state;
    state.find('form').elements.date.value = thaiDateInput();
    state.find('form').onsubmit = event => saveRecord(state, event);
    state.find('start').onclick = () => startCamera(state);
    state.find('stop').onclick = () => {
      stopCamera(state);
      if (state.current) showImage(state, state.current);
      label(state, 'ปิดกล้องแล้ว');
    };
    state.find('shutter').onclick = () => takePhoto(state, false);
    state.find('auto').onchange = () => { state.steadySince = 0; };
    state.find('pick').onclick = () => state.find('file').click();
    state.find('file').onchange = event => {
      const input = event.currentTarget;
      if (input.files[0]) importImage(state, input.files[0]);
      input.value = '';
    };
    state.find('legacy').onclick = () => window.doScan();
    refreshList(state, true);
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

  function showImage(state, item, populate = false) {
    stopCamera(state);
    state.current = item;
    if (state.imageUrl) URL.revokeObjectURL(state.imageUrl);
    state.imageUrl = URL.createObjectURL(item.blob);
    const preview = state.find('preview');
    preview.src = state.imageUrl;
    preview.hidden = false;
    state.find('empty').hidden = true;
    state.find('start').querySelector('span').textContent = 'ถ่ายภาพใหม่';
    state.find('save').disabled = state.busy;
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

  async function storeImage(state, canvas) {
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.90));
    if (!blob) throw new Error('image encoding failed');
    if (active !== state) return;
    const time = Date.now();
    const entry = { id: crypto.randomUUID(), owner: state.owner, blob,
      width: canvas.width, height: canvas.height, createdAt: time, updatedAt: time };
    try {
      await records('readwrite', store => store.add(entry));
    } catch {
      if (active !== state) return;
      showImage(state, entry, true);
      label(state, 'เก็บฉบับร่างไม่ได้ ภาพยังอยู่ในหน้านี้ กดบันทึกเพื่อลองอีกครั้ง', 'error');
      return;
    }
    if (active !== state) return;
    showImage(state, entry, true);
    label(state, 'เก็บภาพเป็นฉบับร่างแล้ว กรุณาตั้งชื่อเอกสาร', 'good');
    await refreshList(state);
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
      await storeImage(state, canvasFrom(image, image.naturalWidth, image.naturalHeight));
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
      state.find('shutter').hidden = false;
      start.hidden = true;
      stream.getVideoTracks()[0].addEventListener('ended', () => {
        if (active === state && attempt === state.cameraAttempt) {
          stopCamera(state);
          if (state.current) showImage(state, state.current);
          label(state, 'กล้องหยุดทำงาน กรุณาเปิดกล้องอีกครั้ง', 'error');
        }
      });
      label(state, 'จัดเอกสารให้เห็นครบทั้ง 4 มุม');
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

  function inspectFrame(video) {
    const scale = 256 / Math.max(video.videoWidth, video.videoHeight);
    const width = Math.round(video.videoWidth * scale);
    const height = Math.round(video.videoHeight * scale);
    if (sample.width !== width || sample.height !== height) {
      sample.width = width;
      sample.height = height;
    }
    sampleContext.drawImage(video, 0, 0, width, height);
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
    ctx.setLineDash(points ? [] : [4, 3]);
    if (!points) {
      ctx.strokeRect(width * .09, height * .09, width * .82, height * .82);
      return;
    }
    ctx.beginPath();
    points.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    ctx.closePath();
    ctx.stroke();
  }

  function checkFrame(state) {
    const video = state.find('video');
    if (state.busy || video.readyState < 2 || document.hidden) return;
    const frame = inspectFrame(video);
    const previous = state.previous;
    state.previous = frame;
    const ready = frame.points && !frame.issue;
    drawGuide(state.find('guide'), frame, ready);
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

  function cropPaper(source, frame) {
    if (!frame?.points) return source;
    const xs = frame.points.map(point => point.x);
    const ys = frame.points.map(point => point.y);
    const left = Math.max(0, Math.floor((Math.min(...xs) - 2) * source.width / frame.width));
    const top = Math.max(0, Math.floor((Math.min(...ys) - 2) * source.height / frame.height));
    const right = Math.min(source.width, Math.ceil((Math.max(...xs) + 3) * source.width / frame.width));
    const bottom = Math.min(source.height, Math.ceil((Math.max(...ys) + 3) * source.height / frame.height));
    const cropped = document.createElement('canvas');
    cropped.width = right - left;
    cropped.height = bottom - top;
    cropped.getContext('2d').drawImage(source, -left, -top);
    return cropped;
  }

  async function takePhoto(state, automatic) {
    const video = state.find('video');
    if (state.busy || !state.stream || video.readyState < 2) return;
    setBusy(state, true);
    try {
      const raw = canvasFrom(video, video.videoWidth, video.videoHeight);
      const frame = state.previous;
      stopCamera(state);
      label(state, 'กำลังเก็บภาพเป็นฉบับร่าง');
      await storeImage(state, automatic ? cropPaper(raw, frame) : raw);
    } catch {
      stopCamera(state);
      if (state.current) showImage(state, state.current);
      label(state, 'บันทึกภาพไม่ได้ กรุณาเปิดกล้องแล้วลองถ่ายอีกครั้ง', 'error');
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
})();
