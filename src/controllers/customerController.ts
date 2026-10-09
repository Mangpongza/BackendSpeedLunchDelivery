import { Request, Response } from "express";
import { ResultSetHeader, RowDataPacket } from "mysql2";
import { db } from "../config/dbconnect";
import { CustomerModel } from "../models/customerModel";
import { assertInServiceArea, getSettings } from "../shopSettingsService";
import { haversineKm, round } from "../distanceCalculator";
import { HttpError } from "../errorHandler";
import { normalizePhone, requireId, requireLatLng, requireNumber, requireText } from "../validation";

/** ตรวจข้อมูลลูกค้าจาก body (ใช้ทั้งเพิ่มและแก้ไข) */
export async function parseCustomerBody(body: any) {
    const name = requireText(body?.name, "name", 120);
    const phone = normalizePhone(body?.phone);
    const address = String(body?.address ?? "").trim().slice(0, 500);
    const { latitude, longitude } = requireLatLng(body?.latitude, body?.longitude);
    const distance = assertInServiceArea(await getSettings(), latitude, longitude);
    return { name, phone, address, latitude, longitude, distance_from_shop_km: distance };
}

// GET /api/customer
export const getCustomers = async (_req: Request, res: Response) => {
    const [rows] = await db.query("SELECT * FROM customers ORDER BY id");
    return res.json(rows as CustomerModel[]);
};

// GET /api/customer/nearby?latitude=&longitude=&radius_km=1
export const getNearbyCustomers = async (req: Request, res: Response) => {
    const { latitude, longitude } = requireLatLng(req.query.latitude, req.query.longitude);
    const radius = req.query.radius_km === undefined ? 1 : requireNumber(req.query.radius_km, "radius_km", 0.01, 100);

    const [rows] = await db.query("SELECT * FROM customers");
    const nearby = (rows as CustomerModel[])
        .map((c) => ({
            ...c,
            distance_km: round(haversineKm(latitude, longitude, Number(c.latitude), Number(c.longitude)), 3),
        }))
        .filter((c) => c.distance_km <= radius)
        .sort((a, b) => a.distance_km - b.distance_km);
    return res.json(nearby);
};

// GET /api/customer/search/fields?name=สมชาย  หรือ ?phone=0812
export const searchCustomers = async (req: Request, res: Response) => {
    const name = String(req.query.name ?? "").trim();
    const phone = String(req.query.phone ?? "").replace(/[^0-9]/g, "");
    if (!name && !phone) {
        throw new HttpError(400, "Please provide ?name= or ?phone=");
    }
    const where: string[] = [];
    const params: unknown[] = [];
    if (name) { where.push("name LIKE ?"); params.push(`%${name}%`); }
    if (phone) { where.push("phone LIKE ?"); params.push(`%${phone}%`); }
    const [rows] = await db.query(
        `SELECT * FROM customers WHERE ${where.join(" AND ")} ORDER BY name LIMIT 50`,
        params
    );
    return res.json(rows as CustomerModel[]);
};

// GET /api/customer/phone/:phone  ลูกค้าเก่า ใส่เบอร์โทรก็เจอ (ตรงตัว)
export const getCustomerByPhone = async (req: Request, res: Response) => {
    const phone = normalizePhone(req.params.phone);
    const [rows] = await db.query("SELECT * FROM customers WHERE phone = ?", [phone]);
    const customers = rows as CustomerModel[];
    if (customers.length === 0) throw new HttpError(404, "Customer not found");
    return res.json(customers[0]);
};

// GET /api/customer/:id
export const getCustomersByID = async (req: Request, res: Response) => {
    const id = requireId(req.params.id);
    const [rows] = await db.query("SELECT * FROM customers WHERE id = ?", [id]);
    const customers = rows as CustomerModel[];
    if (customers.length === 0) throw new HttpError(404, "Customer not found");
    return res.json(customers[0]);
};

// GET /api/customer/:id/orders  ประวัติการสั่งของลูกค้า
export const getCustomerOrders = async (req: Request, res: Response) => {
    const id = requireId(req.params.id);
    const [rows] = await db.query(
        "SELECT * FROM orders WHERE customer_id = ? ORDER BY order_date DESC, id DESC",
        [id]
    );
    return res.json(rows);
};

// POST /api/customer
export const createCustomer = async (req: Request, res: Response) => {
    const c = await parseCustomerBody(req.body);
    const [dup] = await db.query<RowDataPacket[]>("SELECT id FROM customers WHERE phone = ?", [c.phone]);
    if (dup.length > 0) {
        throw new HttpError(409, "Phone number already exists", { customer_id: dup[0]!.id });
    }
    const [result] = await db.query<ResultSetHeader>(
        "INSERT INTO customers (name, phone, address, latitude, longitude) VALUES (?, ?, ?, ?, ?)",
        [c.name, c.phone, c.address, c.latitude, c.longitude]
    );
    return res.status(201).json({
        affected_rows: result.affectedRows,
        last_id: result.insertId,
        distance_from_shop_km: c.distance_from_shop_km,
    });
};

// PUT /api/customer/:id
export const updateCustomerByID = async (req: Request, res: Response) => {
    const id = requireId(req.params.id);
    const c = await parseCustomerBody(req.body);
    const [dup] = await db.query<RowDataPacket[]>("SELECT id FROM customers WHERE phone = ? AND id <> ?", [c.phone, id]);
    if (dup.length > 0) {
        throw new HttpError(409, "Phone number already used by another customer", { customer_id: dup[0]!.id });
    }
    const [result] = await db.query<ResultSetHeader>(
        "UPDATE customers SET name = ?, phone = ?, address = ?, latitude = ?, longitude = ? WHERE id = ?",
        [c.name, c.phone, c.address, c.latitude, c.longitude, id]
    );
    if (result.affectedRows === 0) throw new HttpError(404, "Customer not found");
    return res.json({ affected_rows: result.affectedRows });
};

// DELETE /api/customer/:id
// ลบได้เมื่อลูกค้าไม่มีออเดอร์ที่อยู่ในแผนที่ยังใช้งาน/ส่งแล้ว (กันแผนของลูกค้าคนอื่นพัง)
export const deleteCustomerByID = async (req: Request, res: Response) => {
    const id = requireId(req.params.id);
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        const [used] = await conn.query<RowDataPacket[]>(
            `SELECT COUNT(*) AS n
             FROM orders o
             JOIN route_stops rs ON rs.order_id = o.id
             JOIN rider_routes rr ON rr.id = rs.route_id
             JOIN delivery_plans p ON p.id = rr.plan_id
             WHERE o.customer_id = ? AND p.status <> 'cancelled'`,
            [id]
        );
        if (Number(used[0]?.n ?? 0) > 0) {
            throw new HttpError(409, "Customer has orders in an active or completed delivery plan");
        }
        const [orders] = await conn.query<ResultSetHeader>("DELETE FROM orders WHERE customer_id = ?", [id]);
        const [result] = await conn.query<ResultSetHeader>("DELETE FROM customers WHERE id = ?", [id]);
        if (result.affectedRows === 0) throw new HttpError(404, "Customer not found");
        await conn.commit();
        return res.json({
            message: "Deleted customer and related orders successfully",
            affected_rows: result.affectedRows,
            deleted_orders: orders.affectedRows,
        });
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
};
