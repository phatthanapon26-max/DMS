# วิธีติดตั้งระบบด้วย Supabase + โดเมนตัวเอง (ไม่ต้องรัน Server)

ระบบนี้เชื่อมต่อ **Supabase** (ฐานข้อมูล PostgreSQL กลาง + เก็บไฟล์บนคลาวด์ ฟรี) ทำให้ข้อมูลแชร์ข้ามเครื่องได้ ไม่ต้องรันเซิร์ฟเวอร์เอง

## ขั้นตอนที่ 1 — สร้างโปรเจกต์ Supabase (ฟรี)
1. เข้า https://supabase.com → ลงทะเบียนด้วย GitHub
2. กด **New Project** → ตั้งชื่อ (เช่น water-doc) → เลือก region (Singapore/Southeast Asia) → ตั้งรหัสผ่าน Database → Create
3. รอโปรเจกต์สร้างเสร็จ (~2 นาที)

## ขั้นตอนที่ 2 — รัน SQL สร้างตาราง
1. เมนูซ้าย **SQL Editor** → กด **New query**
2. เปิดไฟล์ `supabase-setup.sql` → คัดลอกทั้งหมดมาวาง → กด **Run**
3. จะได้ตาราง users, docs, employees, settings, announcements, waterstats พร้อมข้อมูลเริ่มต้น (admin/admin123)

## ขั้นตอนที่ 3 — สร้าง Storage Bucket เก็บไฟล์
1. เมนูซ้าย **Storage** → **New bucket**
2. ชื่อ: `files` → ติ๊ก **Public bucket** → Create
3. (ไฟล์เอกสาร/รูปภาพที่อัพโหลดจะเก็บที่นี่)

## ขั้นตอนที่ 4 — วาง URL และ Anon Key ลงในโค้ด
1. เมนูซ้าย **Project Settings** → **API**
2. คัดลอก **Project URL** (เช่น `https://abcxyz.supabase.co`)
3. คัดลอก **anon public** key (ไม่ใช่ service_role)
4. เปิดไฟล์ `index.html` → หาบรรทัด:
   ```js
   const SUPABASE_URL='';
   const SUPABASE_ANON_KEY='';
   ```
   วาง URL และ Key ลงในเครื่องหมายคำพูด → บันทึก

## ขั้นตอนที่ 5 — อัปโหลดขึ้นโฮสติ้ง + ชี้โดเมน
**Netlify (ง่ายสุด):** ลากโฟลเดอร์ทั้งหมดวางที่ https://app.netlify.com/drop → Site settings → Domain management → Add custom domain → ชี้ CNAME จากแผงควบคุมโดเมน

**Vercel:** อัปโหลดขึ้น GitHub → Import ที่ vercel.com → Settings → Domains → เพิ่มโดเมน → ชี้ CNAME ไป `cname.vercel-dns.com`

**GitHub Pages:** อัปโหลดขึ้น GitHub → Settings → Pages → ตั้ง Custom domain

## ขั้นตอนที่ 6 — ทดสอบ
เปิดโดเมนของคุณ → กดเข้าสู่ระบบ → จะเห็นข้อความ **"● เชื่อมต่อ Supabase แล้ว"** → Login ด้วย admin/admin123

---

## Login เริ่มต้น
- Admin: `admin` / `admin123`
- Staff: `staff` / `staff123`
(อย่าลืมเปลี่ยนรหัสผ่านหลังเข้าครั้งแรก และแก้ชื่อระบบ/เบอร์ติดต่อในหน้าตั้งค่า)

## หากไม่วาง Supabase Key
ระบบจะทำงานในโหมดเบราว์เซอร์ (เก็บข้อมูลในเครื่องนั้นๆ ไม่แชร์) — เหมาะสำหรับทดสอบก่อนนำไปใช้จริง

## ความปลอดภัย
- คีย์ `anon` ที่วางในโค้ดเป็นคีย์สาธารณะ (ปลอดภัยที่จะเปิดเผย)
- ถ้าต้องการความปลอดภัยสูง (ผู้ใช้ Login ด้วยอีเมล/รหัสผ่านของ Supabase Auth) สามารถเพิ่มเติมได้ในภายหลัง
