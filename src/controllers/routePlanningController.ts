import { Request, Response } from "express";
import { ResultSetHeader, RowDataPacket } from "mysql2";
import { db } from "../config/dbconnect";
import { CalculatePlanBody, PendingOrderRow } from "../models/deliveryPlanModel";
import { BOX_CAPACITY_PER_RIDER, LATE_PENALTY_PER_ORDER } from "../models/settingsModel";
import { PlannerError, planRoutes } from "../services/routePlanner";
import { getPlanDetail } from "../services/planService";
import { distanceFromShopKm, getSettings } from "../services/settingsService";
import { round } from "../utils/geo";
import { HttpError } from "../utils/http";
import {
    dateOrToday,
    isValidDateStr,
    isValidTimeStr,
    minutesToTimeString,
    normalizeTime,
    requireId,
    timeToMinutes,
} from "../utils/validate";

const PENDING_ORDER_SQL = `
    SELECT o.id, o.customer_id, o.quantity, o.order_date,
           c.name AS customer_name, c.phone, c.address, c.latitude, c.longitude
    FROM orders o
    JOIN customers c ON c.id = o.customer_id
    WHERE o.status = 'pending' AND o.order_date = ?
    ORDER BY o.id`;

// ---------- GET /api/route/pending?date=YYYY-MM-DD ----------
export const getPendingOrders = async (req: Request, res: Response) => {
    const date = dateOrToday(req.query.date);
    const settings = await getSettings();
    const [rows] = await db.query(PENDING_ORDER_SQL, [date]);
    const orders = (rows as PendingOrderRow[]).map((o) => ({
        ...o,
        distance_from_shop_km: distanceFromShopKm(settings, Number(o.latitude), Number(o.longitude)),
    }));
    return res.json({
        delivery_date: date,
        total_orders: orders.length,
        total_boxes: orders.reduce((s, o) => s + Number(o.quantity), 0),
        min_riders_needed: Math.max(
            Math.ceil(orders.length / settings.max_orders_per_rider),
            Math.ceil(orders.reduce((s, o) => s + Number(o.quantity), 0) / BOX_CAPACITY_PER_RIDER)
        ),
        orders,
    });
};

// ---------- POST /api/route/calculate ----------
// ปุ่ม "จัดเส้นทาง": คำนวณ + บันทึกแผน + สร้างใบงานไรเดอร์
// ถ้าวันนั้นมีแผนเดิมอยู่และยังไม่มีใครเริ่มส่ง แผนเดิมจะถูกยกเลิกแล้วสร้าง revision ใหม่
export const calculatePlan = async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as CalculatePlanBody;
    const deliveryDate = dateOrToday(body.delivery_date, "delivery_date");
    const minRiders = Number(body.rider_count ?? 1);
    const departureTime = normalizeTime(String(body.departure_time ?? "11:30:00"));
    const deadlineTime = normalizeTime(String(body.deadline_time ?? "12:30:00"));
    const speedKmh = Number(body.speed_kmh ?? 30);

    if (!Number.isInteger(minRiders) || minRiders < 1 || minRiders > 50) {
        throw new HttpError(400, "rider_count must be between 1 and 50");
    }
    if (!isValidTimeStr(departureTime) || !isValidTimeStr(deadlineTime)) {
        throw new HttpError(400, "Invalid time format (HH:MM:SS)");
    }
    if (timeToMinutes(deadlineTime) <= timeToMinutes(departureTime)) {
        throw new HttpError(400, "deadline_time must be after departure_time");
    }
    if (!(speedKmh > 0 && speedKmh <= 120)) {
        throw new HttpError(400, "speed_kmh must be between 1 and 120");
    }

    const conn = await db.getConnection();
    let planId: number;
    let replacedPlans: number[] = [];
    try {
        await conn.beginTransaction();
        const settings = await getSettings(conn);
        const serviceMinutes = body.service_minutes !== undefined
            ? Number(body.service_minutes)
            : settings.service_minutes_per_stop;
        if (!Number.isInteger(serviceMinutes) || serviceMinutes < 0 || serviceMinutes > 30) {
            throw new HttpError(400, "service_minutes must be between 0 and 30");
        }

        // 1. แผนเดิมของวันนั้น
        const [oldRows] = await conn.query<RowDataPacket[]>(
            `SELECT p.id,
                    (SELECT COUNT(*) FROM rider_routes rr JOIN route_stops rs ON rs.route_id = rr.id
                     WHERE rr.plan_id = p.id AND rs.status = 'delivered') AS delivered_stops
             FROM delivery_plans p
             WHERE p.delivery_date = ? AND p.status <> 'cancelled'
             FOR UPDATE`,
            [deliveryDate]
        );
        if (oldRows.some((p) => Number(p.delivered_stops) > 0)) {
            throw new HttpError(409, "Riders already started delivering today's plan, cannot recalculate");
        }
        replacedPlans = oldRows.map((p) => Number(p.id));
        if (replacedPlans.length > 0) {
            const ph = replacedPlans.map(() => "?").join(",");
            await conn.query(`UPDATE delivery_plans SET status = 'cancelled' WHERE id IN (${ph})`, replacedPlans);
            await conn.query(`UPDATE rider_routes SET status = 'cancelled' WHERE plan_id IN (${ph})`, replacedPlans);
            await conn.query(
                `UPDATE route_stops rs JOIN rider_routes rr ON rr.id = rs.route_id
                 SET rs.status = 'cancelled' WHERE rr.plan_id IN (${ph}) AND rs.status = 'pending'`,
                replacedPlans
            );
        }

        // 2. ออเดอร์รอส่ง
        const [orderRows] = await conn.query(`${PENDING_ORDER_SQL} FOR UPDATE`, [deliveryDate]);
        const orders = (orderRows as PendingOrderRow[]).map((o) => ({
            ...o,
            id: Number(o.id),
            quantity: Number(o.quantity),
            latitude: Number(o.latitude),
            longitude: Number(o.longitude),
        }));
        if (orders.length === 0) throw new HttpError(400, `No pending orders on ${deliveryDate}`);

        // 3. ไรเดอร์ เรียงคนที่ได้งานน้อยใน 7 วันล่าสุดก่อน (กระจายงานให้ยุติธรรม)
        const [riderRows] = await conn.query<RowDataPacket[]>(
            `SELECT r.id, r.name, r.phone, COUNT(rr.id) AS recent_jobs
             FROM riders r
             LEFT JOIN rider_routes rr ON rr.rider_id = r.id AND rr.status <> 'cancelled'
                  AND rr.plan_id IN (SELECT id FROM delivery_plans
                                     WHERE delivery_date BETWEEN DATE_SUB(?, INTERVAL 7 DAY) AND ?)
             GROUP BY r.id
             ORDER BY recent_jobs ASC, r.id ASC`,
            [deliveryDate, deliveryDate]
        );
        if (riderRows.length === 0) throw new HttpError(400, "No riders in the system, add riders first (POST /api/riders)");

        // 4. คำนวณ
        const departureMin = timeToMinutes(departureTime);
        let plan;
        try {
            plan = planRoutes(orders, {
                shopLat: settings.shop_latitude,
                shopLng: settings.shop_longitude,
                minRiders,
                maxRiders: riderRows.length,
                maxStopsPerRoute: settings.max_orders_per_rider,
                boxCapacity: BOX_CAPACITY_PER_RIDER,
                speedKmh,
                serviceMinutes,
                departureMin,
                deadlineMin: timeToMinutes(deadlineTime),
                baseFee: settings.rider_base_fee,
                feePerKmPerBox: settings.rider_fee_per_km_per_box,
                latePenalty: LATE_PENALTY_PER_ORDER,
            });
        } catch (e) {
            if (e instanceof PlannerError) throw new HttpError(400, e.message);
            throw e;
        }

        const revenue = plan.totalBoxes * settings.box_price;
        const foodCost = plan.totalBoxes * settings.box_cost;
        const profit = revenue - foodCost - plan.deliveryCost - plan.latePenalty;

        // 5. บันทึก
        const [revRows] = await conn.query<RowDataPacket[]>(
            "SELECT COALESCE(MAX(revision), 0) + 1 AS next_revision FROM delivery_plans WHERE delivery_date = ?",
            [deliveryDate]
        );
        const revision = Number(revRows[0]?.next_revision ?? 1);

        const [planResult] = await conn.query<ResultSetHeader>(
            `INSERT INTO delivery_plans
             (settings_id, delivery_date, revision, status, departure_time, deadline_time,
              rider_count, total_orders, total_boxes, distance_km, delivery_cost, revenue,
              food_cost, late_orders, late_penalty, profit, last_arrival_time, all_on_time)
             VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                settings.id, deliveryDate, revision, departureTime, deadlineTime,
                plan.riderCount, orders.length, plan.totalBoxes, round(plan.distanceKm),
                round(plan.deliveryCost), round(revenue), round(foodCost),
                plan.lateOrders, round(plan.latePenalty), round(profit),
                minutesToTimeString(plan.lastArrivalMin), plan.lateOrders === 0,
            ]
        );
        planId = planResult.insertId;

        for (let i = 0; i < plan.routes.length; i++) {
            const route = plan.routes[i]!;
            const rider = riderRows[i]!;
            const jobCode = `JOB${String(planId).padStart(6, "0")}-${String(i + 1).padStart(2, "0")}`;
            const points = [
                [settings.shop_latitude, settings.shop_longitude],
                ...route.stops.map((s) => [s.order.latitude, s.order.longitude]),
                [settings.shop_latitude, settings.shop_longitude], // ส่งเสร็จกลับร้าน
            ];
            const navigationUrl = "https://www.google.com/maps/dir/" + points.map((p) => `${p[0]},${p[1]}`).join("/");

            const [routeResult] = await conn.query<ResultSetHeader>(
                `INSERT INTO rider_routes
                 (plan_id, rider_id, rider_number, job_code, total_boxes, distance_km,
                  duration_minutes, delivery_cost, geometry, navigation_url, status)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'assigned')`,
                [
                    planId, rider.id, i + 1, jobCode, route.totalBoxes, round(route.distanceKm),
                    Math.round(route.durationMinutes), round(route.deliveryCost),
                    JSON.stringify(points), navigationUrl,
                ]
            );

            for (const stop of route.stops) {
                await conn.query(
                    `INSERT INTO route_stops
                     (route_id, order_id, stop_sequence, distance_from_previous_km, arrival_time, status)
                     VALUES (?, ?, ?, ?, ?, 'pending')`,
                    [
                        routeResult.insertId, stop.order.id, stop.sequence,
                        round(stop.distanceFromPreviousKm), minutesToTimeString(stop.arrivalMin),
                    ]
                );
            }
        }

        await conn.commit();
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }

    const detail = await getPlanDetail(planId);
    return res.status(201).json({ ...detail, replaced_plan_ids: replacedPlans });
};

// ---------- GET /api/route/plans?date=&status= ----------
export const getPlans = async (req: Request, res: Response) => {
    const date = String(req.query.date ?? "").trim();
    const status = String(req.query.status ?? "").trim();
    const params: unknown[] = [];
    let sql = "SELECT * FROM delivery_plans WHERE 1=1";
    if (date) {
        if (!isValidDateStr(date)) throw new HttpError(400, "Invalid date (YYYY-MM-DD)");
        sql += " AND delivery_date = ?";
        params.push(date);
    }
    if (status) {
        if (!["active", "completed", "cancelled"].includes(status)) {
            throw new HttpError(400, "status must be active, completed or cancelled");
        }
        sql += " AND status = ?";
        params.push(status);
    }
    sql += " ORDER BY delivery_date DESC, revision DESC LIMIT 50";
    const [rows] = await db.query(sql, params);
    return res.json(rows);
};

// ---------- GET /api/route/plans/latest?date= ----------
// แผนที่ใช้งานล่าสุดของวัน (หน้าแดชบอร์ดแผนที่)
export const getLatestPlan = async (req: Request, res: Response) => {
    const date = dateOrToday(req.query.date);
    const [rows] = await db.query<RowDataPacket[]>(
        `SELECT id FROM delivery_plans
         WHERE delivery_date = ? AND status <> 'cancelled'
         ORDER BY revision DESC LIMIT 1`,
        [date]
    );
    if (rows.length === 0) throw new HttpError(404, `No plan for ${date}`);
    return res.json(await getPlanDetail(Number(rows[0]!.id)));
};

// ---------- GET /api/route/plans/:id ----------
export const getPlanById = async (req: Request, res: Response) => {
    return res.json(await getPlanDetail(requireId(req.params.id)));
};

// ---------- DELETE /api/route/plans/:id ----------
// ยกเลิกแผน (ไม่ลบจริง เก็บเป็นประวัติ) ทำได้เมื่อยังไม่มีใครส่งของ
export const cancelPlan = async (req: Request, res: Response) => {
    const id = requireId(req.params.id);
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        const [rows] = await conn.query<RowDataPacket[]>(
            `SELECT p.status,
                    (SELECT COUNT(*) FROM rider_routes rr JOIN route_stops rs ON rs.route_id = rr.id
                     WHERE rr.plan_id = p.id AND rs.status = 'delivered') AS delivered_stops
             FROM delivery_plans p WHERE p.id = ? FOR UPDATE`,
            [id]
        );
        const plan = rows[0];
        if (!plan) throw new HttpError(404, "Plan not found");
        if (plan.status === "cancelled") throw new HttpError(400, "Plan already cancelled");
        if (Number(plan.delivered_stops) > 0) throw new HttpError(409, "Plan already has delivered stops");

        await conn.query("UPDATE delivery_plans SET status = 'cancelled' WHERE id = ?", [id]);
        await conn.query("UPDATE rider_routes SET status = 'cancelled' WHERE plan_id = ?", [id]);
        await conn.query(
            `UPDATE route_stops rs JOIN rider_routes rr ON rr.id = rs.route_id
             SET rs.status = 'cancelled' WHERE rr.plan_id = ? AND rs.status = 'pending'`,
            [id]
        );
        await conn.commit();
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
    return res.json({ message: "Plan cancelled", plan_id: id });
};

// ---------- GET /api/route/shop (เส้นเดิม คงไว้ให้หน้าบ้านเก่าใช้ได้) ----------
export const getShop = async (_req: Request, res: Response) => {
    return res.json(await getSettings());
};
