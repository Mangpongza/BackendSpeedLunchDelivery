# SpeedLunchDelivery Backend

REST API สำหรับระบบส่งอาหารมื้อเที่ยง จัดการลูกค้า ออเดอร์ แผนส่งอาหาร และใบงานไรเดอร์ ใช้ TypeScript, Express และ MySQL

## เริ่มใช้งาน

1. ติดตั้ง dependencies ด้วย `npm install`
2. คัดลอกไฟล์ตั้งค่าด้วย `Copy-Item .env.example .env` แล้วกรอกข้อมูล MySQL
3. นำเข้า `sqlschema.sql` ผ่าน phpMyAdmin หรือ MySQL Workbench เพื่อสร้างฐานข้อมูล `speed_lunch_delivery`
4. เพิ่มไรเดอร์ลงตาราง `riders` ก่อนคำนวณ เช่น:

   ```sql
   INSERT INTO riders (name, phone) VALUES ('ไรเดอร์ 1', '0800000000');
   ```

5. เริ่มเซิร์ฟเวอร์ด้วย `npm run dev`

Base URL: `http://localhost:3000`

| คำสั่ง | หน้าที่ |
|---|---|
| `npm run dev` | รันเซิร์ฟเวอร์และรีสตาร์ตเมื่อแก้ไฟล์ |
| `npm start` | รันเซิร์ฟเวอร์ |
| `npm run build` | คอมไพล์ TypeScript |
| `npm test` | ตรวจการคอมไพล์ TypeScript |

ตั้งค่า `DB_NAME` ใน `.env` ให้ตรงกับฐานข้อมูลที่นำเข้า ตัวอย่างเรียก API อยู่ใน `requests.http`

หากสร้างฐานข้อมูลด้วย schema รุ่นก่อนที่ยังมีคอลัมน์ `color` ให้รัน `remove-route-color.sql` หนึ่งครั้งก่อนเปิด Backend รุ่นนี้

## เส้น API

| Method | Path | หน้าที่ |
|---|---|---|
| GET, POST | /api/customer | อ่านรายการ / เพิ่มลูกค้า |
| GET, PUT, DELETE | /api/customer/:id | อ่าน / แก้ไข / ลบลูกค้า |
| GET | /api/customer/nearby?latitude=16.2462&longitude=103.2501 | ค้นลูกค้าใกล้พิกัด |
| GET | /api/customer/search/fields?name=ชื่อ | ค้นลูกค้าตามชื่อ |
| GET, POST | /api/order | อ่านรายการ / เพิ่มออเดอร์ |
| GET, PUT, DELETE | /api/order/:id | อ่าน / แก้ไข / ยกเลิกออเดอร์ |
| GET | /api/order/nearby?latitude=16.2462&longitude=103.2501 | ค้นออเดอร์ใกล้พิกัด |
| POST | /api/order/random | สร้างออเดอร์ทดสอบ |
| DELETE | /api/order/demo | ล้างออเดอร์ทดสอบและแผนที่เกี่ยวข้อง |
| POST | /api/route/calculate | คำนวณและบันทึกแผนส่ง |
| GET | /api/route/plans | อ่านรายการแผนส่ง |
| GET | /api/route/plans/:id | อ่านรายละเอียดแผนส่ง |
| GET | /api/route/pending?date=2026-10-08 | อ่านออเดอร์รอส่งตามวันที่ |
| GET | /api/route/riders | อ่านรายชื่อไรเดอร์ |
| GET | /api/route/shop | อ่านข้อมูลร้าน |
| GET | /api/jobs?search=คำค้น | ค้นใบงาน |
| GET | /api/jobs/:code | อ่านรายละเอียดใบงาน |

## ตัวอย่างข้อมูล JSON

เพิ่มลูกค้า:

```json
{"name":"ลูกค้าทดสอบ","phone":"0800000000","address":"หน้ามหาวิทยาลัย","latitude":16.247,"longitude":103.251}
```

เพิ่มออเดอร์:

```json
{"customer_id":1,"quantity":2,"order_date":"2026-10-08"}
```

คำนวณแผนส่ง:

```json
{"delivery_date":"2026-10-08","rider_count":1,"departure_time":"11:30:00","deadline_time":"12:30:00","speed_kmh":30,"service_minutes":2}
```

## การทำงานของระบบ

- ชื่อ field ใช้ snake_case และสถานะออเดอร์เป็น `pending`, `delivered`, `cancelled`
- `/api/route/calculate` คำนวณและบันทึกแผนพร้อมใบงานทันที
- แต่ละเส้นทางมีจุดส่งได้สูงสุด 3 จุด ออเดอร์ละ 1–3 กล่อง
- ระยะทางคำนวณด้วย Haversine เป็นระยะเส้นตรง
- การแก้ออเดอร์ใช้ `PUT /api/order/:id`
- การลบลูกค้าลบออเดอร์และแผนที่เกี่ยวข้องด้วย
- Frontend ต้องเรียก URL ให้ตรงและแปลง snake_case ให้ตรงกับ model หน้าบ้าน
- ระบบยังไม่มีการยืนยันตัวตนและกำหนดสิทธิ์ผู้ใช้

## ฐานข้อมูล

มี 7 ตาราง: `shops`, `customers`, `orders`, `riders`, `delivery_plans`, `rider_routes`, `route_stops`

ตั้งค่าร้านและราคาจากตาราง `shops` ใบงานเก็บใน `rider_routes` โดยใช้ `job_code` เป็นรหัสใบงาน
