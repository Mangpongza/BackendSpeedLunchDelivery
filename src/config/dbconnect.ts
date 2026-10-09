import { createPool } from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config()

export const db = createPool({
    connectionLimit: 10,
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER ?? 'root',
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_NAME ?? 'speed_lunch_delivery',
    // คืนค่า DATE/DATETIME เป็น string ตรงๆ ป้องกันวันที่เลื่อนเพราะ timezone (เช่น 2026-10-08 กลายเป็น 2026-10-07T17:00Z)
    dateStrings: true,
    // DECIMAL คืนเป็น number แทน string
    decimalNumbers: true,
});
