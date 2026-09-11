# วิธีนำไปใช้กับโดเมนตัวเอง (แบบไม่ต้องรัน Server — Static Hosting)

เวอร์ชันนี้ใช้งานได้ทันทีกับโฮสติ้งแบบ Static (ไม่ต้องติดตั้ง Node ไม่ต้องรันคำสั่งอะไร)
ฐานข้อมูลจะเก็บในเบราว์เซอร์ของผู้ใช้ (Browser Storage) พร้อมข้อมูลเริ่มต้น Login ได้ทันที

## Login เริ่มต้น
- Admin: `admin` / `admin123`
- Staff: `staff` / `staff123`

---

## วิธีที่ 1 — Netlify (ง่ายที่สุด ลากไฟล์วางได้เลย)
1. แตกไฟล์ zip นี้
2. เข้า https://app.netlify.com/drop (ลงทะเบียนฟรีด้วย Gmail)
3. **ลากโฟลเดอร์ที่แตกไฟล์มาวาง** ในหน้าเว็บ → รอ 10 วินาที จะได้ URL ชั่วคราว
4. ตั้งโดเมนเอง: Site settings → Domain management → Add custom domain → ใส่โดเมนของคุณ
5. ชี้ DNS: เข้าแผงควบคุมโดเมน สร้าง **CNAME Record** ชี้ไปยัง URL ของ Netlify (หรือ A Record ไปยังไอพี Netlify ที่แจ้งให้)
6. รอ 5-30 นาที → Netlify ติดตั้ง HTTPS ให้อัตโนมัติ

## วิธีที่ 2 — Vercel (เหมาะถ้าจะพัฒนาต่อ)
1. อัปโหลดโฟลเดอร์นี้ขึ้น GitHub (เป็น Public Repository)
2. เข้า https://vercel.com → Add New → Project → เลือก Repo นั้น → Deploy
3. ตั้งโดเมน: Settings → Domains → Add → ใส่โดเมนของคุณ
4. ชี้ DNS ตามที่ Vercel แนะนำ (CNAME ไป cname.vercel-dns.com)
5. Vercel ติดตั้ง HTTPS อัตโนมัติ

## วิธีที่ 3 — GitHub Pages (ฟรี ถ้ามี GitHub)
1. อัปโหลดโฟลเดอร์นี้ขึ้น GitHub Repository (ไฟล์ .nojekyll มีอยู่แล้ว)
2. Settings → Pages → Source: main branch / root → Save
3. จะได้ URL `https://<username>.github.io/<repo>/`
4. ตั้งโดเมนเอง: Pages → Custom domain → ใส่โดเมน → ชี้ CNAME ไป `<username>.github.io`
5. ติ๊ก Enforce HTTPS

---

## ข้อสำคัญที่ต้องทราบ (Static Hosting)
- **ข้อมูลเก็บในเบราว์เซอร์ของแต่ละเครื่อง** (ไม่ใช่ฐานข้อมูลกลาง) — เหมาะกับใช้งานบนเครื่องเดียว หรือเป็นตัวอย่างการใช้งาน
- ถ้าต้องการ **ข้อมูลกลางแชร์กันได้หลายคน + บันทึกลง Hard Disk จริง + เชื่อมปริ้นเตอร์สแกน** จำเป็นต้องมี Server (VPS) รัน `npm start` — ดูคู่มือในไฟล์ DEPLOY.md ของเวอร์ชันเต็ม
- ทางเลือกกลาง: ใช้ **Supabase (ฟรี)** เป็นฐานข้อมูลกลางบนคลาวด์ — ไม่ต้องรันเซิร์ฟเวอร์เอง สามารถเพิ่มเชื่อมต่อได้ในภายหลัง

## หากต้องการเปลี่ยนรหัสผ่าน / ข้อมูลองค์กร
เข้าระบบด้วย Admin → เมนู **ตั้งค่าระบบ** → แก้ไขชื่อระบบ เบอร์ติดต่อ ฝ่าย ตำแหน่ง ประเภทเอกสาร ได้ทั้งหมด
