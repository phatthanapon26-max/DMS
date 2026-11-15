(() => {
  'use strict';

  function create(root) {
    const dialog=document.createElement('dialog');
    dialog.className='scan-sign-dialog';
    dialog.setAttribute('aria-labelledby','scan-sign-heading');
    dialog.innerHTML=`
      <form>
        <header class="scan-sign-head"><div><h2 id="scan-sign-heading">ลงนามเอกสาร</h2><p data-sign="title"></p></div>
          <button type="button" class="scan-button" data-sign="cancel">ปิด</button></header>
        <div class="scan-sign-grid">
          <section class="scan-sign-controls">
            <label class="scan-field">ชื่อผู้ลงนาม<input name="signer" required maxlength="100" autocomplete="name"></label>
            <div class="scan-head"><h3>วาดลายเซ็น</h3><button type="button" class="scan-button" data-sign="clear">ล้าง</button></div>
            <canvas data-sign="pad" width="640" height="200" aria-label="วาดลายเซ็นด้วยนิ้วหรือเมาส์"></canvas>
            <label class="scan-field">ขนาดลายเซ็น<input name="size" type="range" min="10" max="50" value="26"></label>
            <details><summary>ปรับตำแหน่งละเอียด</summary>
              <label class="scan-field">แนวนอน<input name="x" type="range" min="0" max="100" value="85"></label>
              <label class="scan-field">แนวตั้ง<input name="y" type="range" min="0" max="100" value="91"></label>
            </details>
          </section>
          <section class="scan-sign-preview"><b>ตัวอย่างเอกสาร</b><p>แตะภาพเพื่อวางลายเซ็น</p>
            <canvas data-sign="preview" aria-label="ตัวอย่างตำแหน่งลายเซ็น"></canvas></section>
        </div>
        <footer><p class="scan-note">ระบบบันทึก PDF ที่ประทับภาพลายเซ็นเป็นสำเนาเข้ารหัสแยกจากต้นฉบับ</p>
          <p data-sign="status" role="status"></p>
          <button type="submit" class="scan-button primary" data-sign="save" disabled>บันทึก PDF ลงนาม</button></footer>
      </form>`;
    root.append(dialog);
    const find=key=>dialog.querySelector('[data-sign="'+key+'"]');
    const form=dialog.querySelector('form');
    const {signer,size,x,y}=form.elements;
    const pad=find('pad'), preview=find('preview'), save=find('save'), status=find('status');
    const ink=pad.getContext('2d'), display=preview.getContext('2d');
    let item=null,source=null,callback=null,box=null,pointer=null,busy=false,load=0;

    function placement() {
      const factor=Math.min(preview.width*Number(size.value)/100/box.w,preview.height*.3/box.h);
      const w=box.w*factor,h=box.h*factor;
      return {w,h,x:Number(x.value)/100*(preview.width-w),y:Number(y.value)/100*(preview.height-h)};
    }
    function redraw() {
      save.disabled=busy||!source||!box||!signer.value.trim();
      if(!source)return;
      display.fillStyle='#fff';display.fillRect(0,0,preview.width,preview.height);
      display.drawImage(source,0,0,preview.width,preview.height);
      if(box){
        const target=placement();
        display.drawImage(pad,box.x,box.y,box.w,box.h,target.x,target.y,target.w,target.h);
      }
    }
    function cleanInk() {
      ink.clearRect(0,0,pad.width,pad.height);
      box=null;pointer=null;
      redraw();
    }
    function reset() {
      load++;
      item=null;source=null;callback=null;busy=false;cleanInk();
      preview.width=1;preview.height=1;preview.hidden=true;
      status.textContent='';
    }
    function extend(from,to) {
      const x=Math.max(0,Math.min(from.x-4,to.x-4,box?.x??Infinity));
      const y=Math.max(0,Math.min(from.y-4,to.y-4,box?.y??Infinity));
      const right=Math.min(pad.width,Math.max(from.x+4,to.x+4,box?box.x+box.w:0));
      const bottom=Math.min(pad.height,Math.max(from.y+4,to.y+4,box?box.y+box.h:0));
      box={x,y,w:right-x,h:bottom-y};
    }
    function eventPoint(event,canvas) {
      const rect=canvas.getBoundingClientRect();
      return {x:Math.max(0,Math.min(canvas.width,(event.clientX-rect.left)*canvas.width/rect.width)),
        y:Math.max(0,Math.min(canvas.height,(event.clientY-rect.top)*canvas.height/rect.height))};
    }
    pad.onpointerdown=event=>{
      if(busy||pointer||event.button!==0)return;
      pointer={id:event.pointerId,point:eventPoint(event,pad)};
      pad.setPointerCapture(event.pointerId);
    };
    pad.onpointermove=event=>{
      if(busy||pointer?.id!==event.pointerId)return;
      const next=eventPoint(event,pad),from=pointer.point;
      if(Math.hypot(from.x-next.x,from.y-next.y)<2)return;
      ink.beginPath();ink.moveTo(from.x,from.y);ink.lineTo(next.x,next.y);
      ink.strokeStyle='#143863';ink.lineWidth=5;ink.lineCap='round';ink.stroke();
      extend(from,next);pointer.point=next;
      redraw();
    };
    for(const key of ['pointerup','pointercancel','lostpointercapture']) pad.addEventListener(key,event=>{
      if(pointer?.id===event.pointerId)pointer=null;
    });
    preview.onclick=event=>{
      if(!box||busy)return;
      const point=eventPoint(event,preview), target=placement();
      const position=(value,extent,width)=>100*Math.max(0,Math.min(1,(value-width/2)/(extent-width)));
      x.value=position(point.x,preview.width,target.w);
      y.value=position(point.y,preview.height,target.h);
      redraw();
    };
    for(const field of [signer,size,x,y]) field.oninput=redraw;
    const controls=[signer,size,x,y,find('clear'),find('cancel')];
    function markBusy(value) {
      busy=value;
      for(const control of controls)control.disabled=value;
      redraw();
    }
    find('clear').onclick=cleanInk;
    find('cancel').onclick=()=>dialog.close();
    dialog.oncancel=event=>{if(busy)event.preventDefault();};
    dialog.onclose=()=>{if(!dialog.open)reset();};
    form.onsubmit=async event=>{
      event.preventDefault();
      if(save.disabled)return;
      const result=callback, name=signer.value.trim(), id=load;
      markBusy(true);
      status.textContent='กำลังบันทึกสำเนาเข้ารหัส…';
      try {
        const jpeg=await new Promise((resolve,reject)=>preview.toBlob(
          blob=>blob?resolve(blob):reject(Error('สร้างภาพลงนามไม่ได้')),'image/jpeg',.95
        ));
        if(id!==load)return;
        await result(jpeg,name);
        if(id===load)dialog.close();
      } catch(error) {
        if(id===load)status.textContent=error.message||'บันทึกสำเนาไม่ได้ กรุณาลองอีกครั้ง';
      } finally {if(id===load)markBusy(false);}
    };

    return {
      async open(document,name,onSave) {
        reset();
        markBusy(false);
        item=document;callback=onSave;
        find('title').textContent=[item.title,item.number].filter(Boolean).join(' · ');
        signer.value=name;size.value='26';x.value='85';y.value='91';
        dialog.showModal();
        const seq=load;
        const image=new Image(),url=URL.createObjectURL(item.blob);
        status.textContent='กำลังเปิดภาพตัวอย่าง…';
        try {
          image.src=url;await image.decode();
          if(seq!==load)return;
          source=image;preview.width=image.naturalWidth;preview.height=image.naturalHeight;
          preview.hidden=false;status.textContent='';redraw();
        } catch {
          if(seq===load)status.textContent='เปิดภาพสำหรับลงนามไม่ได้';
        } finally {URL.revokeObjectURL(url);}
      },
      close() {
        if(dialog.open)dialog.close();
        reset();
      }
    };
  }
  window.FreshyScanSign={create};
})();
