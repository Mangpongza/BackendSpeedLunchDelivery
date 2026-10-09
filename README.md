# SpeedLunchDelivery Backend

REST API สำหรับระบบจัดเส้นทางและแบ่งงานไรเดอร์ "ส่งด่วนมื้อเที่ยง" (TypeScript + Express 5 + MySQL)

## เริ่มใช้งาน

1. `npm install`
2. `Copy-Item .env.example .env` แล้วกรอกข้อมูล MySQL และตั้ง `AUTH_SECRET`
3. นำเข้า `sqlschema.sql` (phpMyAdmin / MySQL Workbench) ได้ฐานข้อมูล `speed_lunch_delivery` พร้อมข้อมูลร้านและไรเดอร์ตัวอย่าง 5 คน
   - ถ้าเคยนำเข้า schema รุ่นเก่าแล้ว ให้ `DROP DATABASE speed_lunch_delivery;` ก่อน แล้วค่อยนำเข้าใหม่ (โครงสร้างตารางเปลี่ยนตาม ER)
4. `npm run dev` แล้วเปิด `http://localhost:3000/api/health`
5. ตัวอย่างเรียกทุกเส้นอยู่ใน `requests.http` (ใช้กับ VS Code REST Client)

## เส้น API

รูปแบบ field เป็น snake_case วันที่ `YYYY-MM-DD` เวลา `HH:MM:SS` ถ้าไม่ส่ง `date` จะใช้วันนี้ (เวลาไทย)
Error ทุกเส้นตอบเป็น `{ "error": "...", "details"?: ... }` พร้อม status 400/401/403/404/409/500

### ตั้งค่าร้าน (settings)

| Method | Path | หน้าที่ |
|---|---|---|
| GET | /api/settings | อ่านข้อมูลร้าน ราคา และกติกาการส่ง |
| PUT | /api/settings | แก้เฉพาะ field ที่ส่งมา เช่น `{"box_price":70}` |

### ลูกค้า

| Method | Path | หน้าที่ |
|---|---|---|
| GET, POST | /api/customer | อ่านทั้งหมด / เพิ่มลูกค้า (เบอร์ซ้ำได้ 409, นอกรัศมีให้บริการได้ 400) |
| GET | /api/customer/phone/:phone | **ลูกค้าเก่า ใส่เบอร์โทรก็เจอ** |
| GET | /api/customer/search/fields?name=&phone= | ค้นบางส่วนของชื่อ/เบอร์ |
| GET | /api/customer/nearby?latitude=&longitude=&radius_km=1 | ค้นลูกค้าใกล้พิกัด |
| GET, PUT, DELETE | /api/customer/:id | อ่าน / แก้ไข / ลบ |
| GET | /api/customer/:id/orders | ประวัติออเดอร์ของลูกค้า |

### ออเดอร์

| Method | Path | หน้าที่ |
|---|---|---|
| GET | /api/order?date=&status=&customer_id= | รายการออเดอร์พร้อมข้อมูลลูกค้าและ job_code |
| POST | /api/order | เพิ่มออเดอร์ `{customer_id, quantity, order_date?}` |
| POST | /api/order/quick | **ฟอร์มเจ้าของร้าน** กรอก ชื่อ เบอร์ พิกัด จำนวนกล่อง ครั้งเดียว (ไม่มีลูกค้าจะสร้างให้) |
| GET, PUT, DELETE | /api/order/:id | อ่าน / แก้ไข / ยกเลิก (ถ้าอยู่ในแผนแล้วจะตอบ `needs_replan: true`) |
| GET | /api/order/nearby?latitude=&longitude=&radius_km=2 | ออเดอร์ใกล้พิกัด |
| POST | /api/order/random | สร้างออเดอร์ทดสอบ `{amount?, order_date?}` |
| DELETE | /api/order/demo | ล้างออเดอร์ทดสอบและแผนที่เกี่ยวข้อง |

### ไรเดอร์ (ฝั่งเจ้าของร้าน)

| Method | Path | หน้าที่ |
|---|---|---|
| GET, POST | /api/riders | รายชื่อ (มีจำนวนงานวันนี้) / เพิ่มไรเดอร์ |
| GET, PUT, DELETE | /api/riders/:id | อ่าน / แก้ไข / ลบ (ลบไม่ได้ถ้าเคยมีใบงาน) |

### จัดเส้นทาง (แดชบอร์ดเจ้าของร้าน)

| Method | Path | หน้าที่ |
|---|---|---|
| GET | /api/route/pending?date= | ออเดอร์รอส่ง + จำนวนกล่อง + ไรเดอร์ขั้นต่ำที่ต้องใช้ |
| POST | /api/route/calculate | **ปุ่ม "จัดเส้นทาง"** คำนวณ บันทึกแผน และสร้างใบงานไรเดอร์ทุกคน |
| GET | /api/route/plans?date=&status= | ประวัติแผน |
| GET | /api/route/plans/latest?date= | แผนล่าสุดของวัน (ใช้วาดแผนที่ เส้นแยกตาม `rider_number`) |
| GET | /api/route/plans/:id | รายละเอียดแผน + ใบงาน + จุดส่ง |
| DELETE | /api/route/plans/:id | ยกเลิกแผน (ได้เมื่อยังไม่มีใครส่งของ) |
| GET | /api/jobs?search=&date=&status= | ค้นใบงาน |
| GET | /api/jobs/:code | รายละเอียดใบงาน |
| GET | /api/route/shop, /api/route/riders | เส้นเดิม (เท่ากับ /api/settings, /api/riders) |

### หน้าจอไรเดอร์ (มือถือ)

ล็อกอินแล้วแนบ header `Authorization: Bearer <token>` ทุกเส้นใน `/api/me`

| Method | Path | หน้าที่ |
|---|---|---|
| POST | /api/auth/rider-login | ล็อกอินด้วยเบอร์โทร `{"phone":"0810000001"}` ได้ `token` |
| GET | /api/me | ข้อมูลไรเดอร์ที่ล็อกอิน |
| GET | /api/me/jobs?date= | **ใบงานของฉันวันนี้** รวมจำนวนกล่อง จุดส่งเรียงลำดับ ลิงก์ Google Maps |
| GET | /api/me/jobs/:code | ใบงาน + `instructions` ("จุดที่ 1 ส่งคุณ A -> ... -> กลับร้าน") |
| PATCH | /api/me/jobs/:code/start | กดเริ่มออกส่ง |
| PATCH | /api/me/jobs/:code/stops/:sequence/deliver | ยืนยันส่งจุดนี้แล้ว (อัปเดตออเดอร์/ใบงาน/แผนอัตโนมัติ) |

## ตัวอย่าง JSON

ฟอร์มเจ้าของร้าน (`POST /api/order/quick`):

```json
{"name":"ลูกค้าทดสอบ","phone":"0800000000","address":"หน้ามหาวิทยาลัย","latitude":16.247,"longitude":103.251,"quantity":2}
```

จัดเส้นทาง (`POST /api/route/calculate`) ส่ง `{}` ก็ได้ ค่าเริ่มต้นคือวันนี้ 11:30–12:30:

```json
{"delivery_date":"2026-10-08","rider_count":1,"departure_time":"11:30:00","deadline_time":"12:30:00","speed_kmh":30}
```

## การทำงานของระบบจัดเส้นทาง

- ไรเดอร์ 1 คนส่งได้ไม่เกิน `max_orders_per_rider` จุด (ER กำหนด 1–3) และไม่เกิน **10 กล่อง** ต่อคัน
- เรียงออเดอร์ตามทิศรอบร้าน แบ่งกลุ่มด้วย Dynamic Programming ลองทุกลำดับการส่งในกลุ่มเพื่อหาระยะสั้นสุด
- เริ่มจากจำนวนไรเดอร์ขั้นต่ำ ถ้ายังมีจุดที่ถึงเกิน `deadline_time` จะเพิ่มไรเดอร์ให้เองจนส่งทัน (หรือจนไรเดอร์หมด)
- ไรเดอร์ที่ได้งานน้อยใน 7 วันล่าสุดจะถูกเลือกก่อน (กระจายงานยุติธรรม)
- กำไร = รายได้ − ต้นทุนอาหาร − ค่าไรเดอร์ − ค่าชดเชยส่งเลทออเดอร์ละ 20 บาท
- ค่าไรเดอร์ต่อคน = `rider_base_fee + rider_fee_per_km_per_box × กล่อง × ระยะทาง`
- ระยะทางเป็นเส้นตรง (Haversine) ลิงก์นำทางเปิด Google Maps ร้าน → จุด 1 → 2 → 3 → กลับร้าน
- กดจัดเส้นทางซ้ำในวันเดียวกัน: แผนเดิมเปลี่ยนเป็น `cancelled` และสร้าง `revision` ใหม่ (ทำไม่ได้ถ้าไรเดอร์เริ่มส่งแล้ว)

สถานะ: ออเดอร์ `pending/delivered/cancelled`, แผน `active/completed/cancelled`,
ใบงาน `assigned/in_progress/completed/cancelled`, จุดส่ง `pending/delivered/cancelled`

## ฐานข้อมูล

7 ตารางตาม ER: `settings`, `customers`, `orders`, `riders`, `delivery_plans`, `rider_routes`, `route_stops`
คอลัมน์ที่มีใน SQL แต่ยังไม่มีใน ER อธิบายไว้ด้านบนของ `sqlschema.sql`

ยังไม่มีบัญชีเจ้าของร้าน: เส้นฝั่งเจ้าของร้านเปิดใช้ได้โดยไม่ต้องล็อกอิน
