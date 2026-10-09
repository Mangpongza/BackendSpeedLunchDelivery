import { Request, Response } from "express";
import { ResultSetHeader, RowDataPacket } from "mysql2";
import { db } from "../config/dbconnect";
import { CreateOrderModel, ORDER_STATUSES, OrderModel, OrderStatus, UpdateOrderModel } from "../models/orderModel";
import { assertInServiceArea, getSettings } from "../shopSettingsService";
import { refreshRouteAndPlanStatus } from "../deliveryPlanService";
import { SettingsModel } from "../models/settingsModel";
import { haversineKm, round } from "../distanceCalculator";
import { HttpError } from "../errorHandler";
import {
    dateOrToday,
    isValidDateStr,
    normalizePhone,
    requireId,
    requireLatLng,
    requireNumber,
    requireText,
} from "../validation";

const ORDER_WITH_CUSTOMER = `
    SELECT o.*, c.name AS customer_name, c.phone AS customer_phone, c.address AS customer_address,
           c.latitude AS customer_latitude, c.longitude AS customer_longitude,
           (SELECT rr.job_code FROM route_stops rs
              JOIN rider_routes rr ON rr.id = rs.route_id
              JOIN delivery_plans p ON p.id = rr.plan_id
             WHERE rs.order_id = o.id AND p.status <> 'cancelled'
             ORDER BY p.revision DESC LIMIT 1) AS job_code
    FROM orders o
    JOIN customers c ON c.id = o.customer_id`;

function requireQuantity(value: unknown, settings: SettingsModel): number {
    return requireNumber(value, "quantity", 1, settings.max_boxes_per_order, true);
}

/** ออเดอร์อยู่ในแผนที่ยังใช้งานไหม (ถ้าแก้/ยกเลิกต้องกดจัดเส้นทางใหม่) */
async function activeStopOf(orderId: number) {
    const [rows] = await db.query<RowDataPacket[]>(
        `SELECT rs.id AS stop_id, rs.status, rs.route_id
         FROM route_stops rs
         JOIN rider_routes rr ON rr.id = rs.route_id
         JOIN delivery_plans p ON p.id = rr.plan_id
         WHERE rs.order_id = ? AND p.status = 'active' AND rr.status <> 'cancelled'
         LIMIT 1`,
        [orderId]
    );
    return rows[0];
}

// GET /api/order?date=YYYY-MM-DD&status=pending&customer_id=1
export const getOrder = async (req: Request, res: Response) => {
    const date = String(req.query.date ?? "").trim();
    const status = String(req.query.status ?? "").trim();
    const customerId = String(req.query.customer_id ?? "").trim();
    const where: string[] = [];
    const params: unknown[] = [];
    if (date) {
        if (!isValidDateStr(date)) throw new HttpError(400, "Invalid date (YYYY-MM-DD)");
        where.push("o.order_date = ?");
        params.push(date);
    }
    if (status) {
        if (!ORDER_STATUSES.includes(status as OrderStatus)) throw new HttpError(400, "status must be pending, delivered or cancelled");
        where.push("o.status = ?");
        params.push(status);
    }
    if (customerId) {
        where.push("o.customer_id = ?");
        params.push(requireId(customerId, "customer_id"));
    }
    const sql = `${ORDER_WITH_CUSTOMER} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY o.order_date DESC, o.id DESC`;
    const [rows] = await db.query(sql, params);
    return res.json(rows);
};

// GET /api/order/nearby?latitude=&longitude=&radius_km=2&date=
export const getNearbyOrders = async (req: Request, res: Response) => {
    const { latitude, longitude } = requireLatLng(req.query.latitude, req.query.longitude);
    const radius = req.query.radius_km === undefined ? 2 : requireNumber(req.query.radius_km, "radius_km", 0.01, 100);
    const date = String(req.query.date ?? "").trim();
    const params: unknown[] = [];
    let sql = ORDER_WITH_CUSTOMER;
    if (date) {
        if (!isValidDateStr(date)) throw new HttpError(400, "Invalid date (YYYY-MM-DD)");
        sql += " WHERE o.order_date = ?";
        params.push(date);
    }
    const [rows] = await db.query<RowDataPacket[]>(sql + " ORDER BY o.id", params);
    const nearby = rows
        .map((o) => ({
            id: o.id,
            quantity: o.quantity,
            order_date: o.order_date,
            status: o.status,
            is_demo: o.is_demo,
            distance_km: round(haversineKm(latitude, longitude, Number(o.customer_latitude), Number(o.customer_longitude)), 3),
            customer: {
                id: o.customer_id,
                name: o.customer_name,
                phone: o.customer_phone,
                address: o.customer_address,
                latitude: o.customer_latitude,
                longitude: o.customer_longitude,
            },
        }))
        .filter((o) => o.distance_km <= radius)
        .sort((a, b) => a.distance_km - b.distance_km);
    return res.json(nearby);
};

// GET /api/order/:id
export const getOrderByID = async (req: Request, res: Response) => {
    const id = requireId(req.params.id);
    const [rows] = await db.query<RowDataPacket[]>(`${ORDER_WITH_CUSTOMER} WHERE o.id = ?`, [id]);
    if (rows.length === 0) throw new HttpError(404, "Order not found"); // เดิมไม่มี return ทำให้ server error
    return res.json(rows[0]);
};

// POST /api/order  { customer_id, quantity, order_date? }
export const createOrder = async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as CreateOrderModel;
    const settings = await getSettings();
    const customerId = requireId(body.customer_id, "customer_id");
    const quantity = requireQuantity(body.quantity, settings);
    const orderDate = dateOrToday(body.order_date, "order_date");

    const [customers] = await db.query<RowDataPacket[]>("SELECT id FROM customers WHERE id = ?", [customerId]);
    if (customers.length === 0) throw new HttpError(404, "Customer not found");

    const [result] = await db.query<ResultSetHeader>(
        "INSERT INTO orders (customer_id, quantity, order_date) VALUES (?, ?, ?)",
        [customerId, quantity, orderDate]
    );
    return res.status(201).json({ affected_rows: result.affectedRows, last_id: result.insertId });
};

// POST /api/order/quick  { name, phone, address?, latitude?, longitude?, quantity, order_date? }
// หน้ากรอกออเดอร์ของเจ้าของร้าน: ค้นลูกค้าจากเบอร์โทร ถ้ายังไม่มีจะสร้างให้ แล้วสร้างออเดอร์ทันที
export const quickOrder = async (req: Request, res: Response) => {
    const body = req.body ?? {};
    const settings = await getSettings();
    const phone = normalizePhone(body.phone);
    const quantity = requireQuantity(body.quantity, settings);
    const orderDate = dateOrToday(body.order_date, "order_date");

    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        const [found] = await conn.query<RowDataPacket[]>("SELECT * FROM customers WHERE phone = ? FOR UPDATE", [phone]);
        let customerId: number;
        let isNewCustomer = false;

        if (found.length > 0) {
            // ลูกค้าเก่า: อัปเดตเฉพาะข้อมูลที่ส่งมา
            const old = found[0]!;
            customerId = Number(old.id);
            const name = body.name !== undefined && String(body.name).trim() ? requireText(body.name, "name", 120) : old.name;
            const address = body.address !== undefined ? String(body.address).trim().slice(0, 500) : old.address;
            let lat = Number(old.latitude), lng = Number(old.longitude);
            if (body.latitude !== undefined || body.longitude !== undefined) {
                const p = requireLatLng(body.latitude, body.longitude);
                assertInServiceArea(settings, p.latitude, p.longitude);
                lat = p.latitude; lng = p.longitude;
            }
            await conn.query(
                "UPDATE customers SET name = ?, address = ?, latitude = ?, longitude = ? WHERE id = ?",
                [name, address, lat, lng, customerId]
            );
        } else {
            const name = requireText(body.name, "name", 120);
            const { latitude, longitude } = requireLatLng(body.latitude, body.longitude);
            assertInServiceArea(settings, latitude, longitude);
            const [r] = await conn.query<ResultSetHeader>(
                "INSERT INTO customers (name, phone, address, latitude, longitude) VALUES (?, ?, ?, ?, ?)",
                [name, phone, String(body.address ?? "").trim().slice(0, 500), latitude, longitude]
            );
            customerId = r.insertId;
            isNewCustomer = true;
        }

        const [orderResult] = await conn.query<ResultSetHeader>(
            "INSERT INTO orders (customer_id, quantity, order_date) VALUES (?, ?, ?)",
            [customerId, quantity, orderDate]
        );
        await conn.commit();
        return res.status(201).json({
            message: isNewCustomer ? "New customer and order created" : "Order created for existing customer",
            is_new_customer: isNewCustomer,
            customer_id: customerId,
            order_id: orderResult.insertId,
        });
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
};

// PUT /api/order/:id  (ส่งเฉพาะ field ที่ต้องการแก้)
export const updateOrderByID = async (req: Request, res: Response) => {
    const id = requireId(req.params.id);
    const body = (req.body ?? {}) as UpdateOrderModel;
    const settings = await getSettings();

    const [rows] = await db.query("SELECT * FROM orders WHERE id = ?", [id]);
    const original = (rows as OrderModel[])[0];
    if (!original) throw new HttpError(404, "Order not found");

    const customerId = body.customer_id !== undefined ? requireId(body.customer_id, "customer_id") : original.customer_id;
    const quantity = body.quantity !== undefined ? requireQuantity(body.quantity, settings) : original.quantity;
    const orderDate = body.order_date !== undefined ? dateOrToday(body.order_date, "order_date") : original.order_date;
    const status = body.status ?? original.status;
    if (!ORDER_STATUSES.includes(status)) throw new HttpError(400, "status must be pending, delivered or cancelled");

    if (customerId !== original.customer_id) {
        const [c] = await db.query<RowDataPacket[]>("SELECT id FROM customers WHERE id = ?", [customerId]);
        if (c.length === 0) throw new HttpError(404, "Customer not found");
    }

    const stop = await activeStopOf(id);
    if (stop && stop.status === "delivered") throw new HttpError(409, "Order already delivered by a rider");

    const [result] = await db.query<ResultSetHeader>(
        "UPDATE orders SET customer_id = ?, quantity = ?, order_date = ?, status = ? WHERE id = ?",
        [customerId, quantity, orderDate, status, id]
    );
    const changed = customerId !== original.customer_id || quantity !== original.quantity ||
        orderDate !== original.order_date || status !== original.status;
    return res.json({
        message: "Order updated successfully",
        affected_rows: result.affectedRows,
        // อยู่ในแผนที่จัดไปแล้ว -> ควรกด /api/route/calculate ใหม่
        needs_replan: Boolean(stop) && changed,
    });
};

// DELETE /api/order/:id  = ยกเลิกออเดอร์ (ไม่ลบจริง)
export const deleteOrderByID = async (req: Request, res: Response) => {
    const id = requireId(req.params.id);
    const [rows] = await db.query("SELECT id, status FROM orders WHERE id = ?", [id]);
    const order = (rows as OrderModel[])[0];
    if (!order) throw new HttpError(404, "Order not found");
    if (order.status === "cancelled") throw new HttpError(400, "Order already cancelled");
    if (order.status === "delivered") throw new HttpError(409, "Order already delivered");

    const stop = await activeStopOf(id);
    await db.query("UPDATE orders SET status = 'cancelled' WHERE id = ?", [id]);
    if (stop) {
        await db.query("UPDATE route_stops SET status = 'cancelled' WHERE id = ?", [stop.stop_id]);
        await refreshRouteAndPlanStatus(Number(stop.route_id), db);
    }
    return res.json({ message: "Order cancelled successfully", needs_replan: Boolean(stop) });
};

// DELETE /api/order/demo  ล้างออเดอร์ทดสอบ + แผนที่มีออเดอร์ทดสอบ
export const clearDemoOrders = async (_req: Request, res: Response) => {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        const [planRows] = await conn.query<RowDataPacket[]>(
            `SELECT DISTINCT rr.plan_id
             FROM route_stops rs
             JOIN orders o ON o.id = rs.order_id
             JOIN rider_routes rr ON rr.id = rs.route_id
             WHERE o.is_demo = TRUE`
        );
        const planIds = planRows.map((row) => Number(row.plan_id));
        let deletedPlans = 0;
        if (planIds.length > 0) {
            const [planResult] = await conn.query<ResultSetHeader>(
                `DELETE FROM delivery_plans WHERE id IN (${planIds.map(() => "?").join(", ")})`,
                planIds
            );
            deletedPlans = planResult.affectedRows;
        }
        const [orderResult] = await conn.query<ResultSetHeader>("DELETE FROM orders WHERE is_demo = TRUE");
        await conn.commit();
        return res.json({
            message: "Demo orders cleared successfully",
            deleted_orders: orderResult.affectedRows,
            deleted_related_plans: deletedPlans,
        });
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
};

// POST /api/order/random  { amount?: 20, order_date?: "YYYY-MM-DD" }  สร้างออเดอร์ทดสอบ
export const randomOrder = async (req: Request, res: Response) => {
    const amount = Number(req.body?.amount ?? 20);
    if (!Number.isInteger(amount) || amount < 1 || amount > 30) {
        throw new HttpError(400, "Amount must be an integer between 1 and 30");
    }
    const orderDate = dateOrToday(req.body?.order_date, "order_date");
    const settings = await getSettings();

    const [rows] = await db.query<RowDataPacket[]>("SELECT id, latitude, longitude FROM customers");
    const customers = rows.filter((c) =>
        haversineKm(settings.shop_latitude, settings.shop_longitude, Number(c.latitude), Number(c.longitude)) <=
        settings.service_radius_km
    );
    if (customers.length === 0) throw new HttpError(400, "No customers inside the service area");

    const values = Array.from({ length: amount }, () => [
        customers[Math.floor(Math.random() * customers.length)]!.id,
        Math.floor(Math.random() * settings.max_boxes_per_order) + 1,
        orderDate,
        "pending",
        true,
    ]);
    await db.query("INSERT INTO orders (customer_id, quantity, order_date, status, is_demo) VALUES ?", [values]);
    return res.status(201).json({ message: "Random orders generated", amount, order_date: orderDate });
};
