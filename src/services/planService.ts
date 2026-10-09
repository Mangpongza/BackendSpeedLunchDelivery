import type { Pool } from "mysql2/promise";
import { RowDataPacket } from "mysql2";
import { db } from "../config/dbconnect";
import { HttpError } from "../utils/http";

type Queryable = Pick<Pool, "query">;

const STOP_SELECT = `
    SELECT rs.id AS stop_id, rs.route_id, rs.order_id, rs.stop_sequence,
           rs.distance_from_previous_km, rs.arrival_time, rs.status, rs.delivered_at,
           o.quantity, o.status AS order_status,
           c.id AS customer_id, c.name AS customer_name, c.phone, c.address,
           c.latitude, c.longitude
    FROM route_stops rs
    JOIN orders o ON o.id = rs.order_id
    JOIN customers c ON c.id = o.customer_id`;

const ROUTE_SELECT = `
    SELECT rr.id AS route_id, rr.plan_id, rr.job_code, rr.rider_number, rr.rider_id,
           r.name AS rider_name, r.phone AS rider_phone,
           rr.total_boxes, rr.distance_km, rr.duration_minutes, rr.delivery_cost,
           rr.geometry, rr.navigation_url, rr.status,
           p.delivery_date, p.revision, p.status AS plan_status,
           p.departure_time, p.deadline_time
    FROM rider_routes rr
    JOIN riders r ON r.id = rr.rider_id
    JOIN delivery_plans p ON p.id = rr.plan_id`;

function parseGeometry(g: unknown): unknown {
    if (typeof g !== "string") return g;
    try { return JSON.parse(g); } catch { return g; }
}

/** แนบจุดส่งเข้าไปในใบงาน */
async function attachStops(routes: RowDataPacket[], conn: Queryable) {
    if (routes.length === 0) return routes;
    const ids = routes.map((r) => r.route_id);
    const [stopRows] = await conn.query(
        `${STOP_SELECT} WHERE rs.route_id IN (${ids.map(() => "?").join(",")}) ORDER BY rs.route_id, rs.stop_sequence`,
        ids
    );
    const stops = stopRows as RowDataPacket[];
    for (const r of routes) {
        r.geometry = parseGeometry(r.geometry);
        r.stops = stops.filter((s) => s.route_id === r.route_id);
        r.total_orders = (r.stops as unknown[]).length;
        r.delivered_orders = (r.stops as RowDataPacket[]).filter((s) => s.status === "delivered").length;
    }
    return routes;
}

/** รายละเอียดแผน + ใบงานทุกคน + จุดส่ง (ใช้วาดแผนที่หน้าแดชบอร์ด) */
export async function getPlanDetail(planId: number, conn: Queryable = db) {
    const [planRows] = await conn.query("SELECT * FROM delivery_plans WHERE id = ?", [planId]);
    const plans = planRows as RowDataPacket[];
    if (plans.length === 0) throw new HttpError(404, "Plan not found");

    const [shopRows] = await conn.query(
        "SELECT shop_name, shop_address, shop_latitude, shop_longitude FROM settings WHERE id = ?",
        [plans[0]!.settings_id]
    );
    const [routeRows] = await conn.query(`${ROUTE_SELECT} WHERE rr.plan_id = ? ORDER BY rr.rider_number`, [planId]);
    const routes = await attachStops(routeRows as RowDataPacket[], conn);

    return {
        ...plans[0],
        all_on_time: Boolean(plans[0]!.all_on_time),
        shop: (shopRows as RowDataPacket[])[0] ?? null,
        routes,
    };
}

/** ใบงาน 1 ใบ (ระบุด้วย job_code) ถ้าส่ง riderId มาจะเช็กว่าเป็นของไรเดอร์คนนั้นจริง */
export async function getJobDetail(jobCode: string, riderId?: number, conn: Queryable = db) {
    const [rows] = await conn.query(`${ROUTE_SELECT} WHERE rr.job_code = ?`, [jobCode]);
    const routes = rows as RowDataPacket[];
    if (routes.length === 0) throw new HttpError(404, "Job not found");
    if (riderId !== undefined && routes[0]!.rider_id !== riderId) {
        throw new HttpError(403, "This job belongs to another rider");
    }
    const [shopRows] = await conn.query(
        "SELECT shop_name, shop_address, shop_latitude, shop_longitude FROM settings WHERE id = 1"
    );
    await attachStops(routes, conn);
    const job = routes[0]!;
    job.shop = (shopRows as RowDataPacket[])[0] ?? null;
    job.instructions = buildInstructions(job);
    return job;
}

/** ข้อความสรุปสำหรับไรเดอร์ เช่น "จุดที่ 1 ไปส่งคุณ A -> ... -> กลับร้าน" */
function buildInstructions(job: RowDataPacket): string[] {
    const lines = [`หยิบข้าวกล่องทั้งหมด ${job.total_boxes} กล่อง ออกจากร้านเวลา ${String(job.departure_time).slice(0, 5)} น.`];
    for (const s of job.stops as RowDataPacket[]) {
        lines.push(
            `จุดที่ ${s.stop_sequence}: ส่งคุณ ${s.customer_name} ${s.quantity} กล่อง (โทร ${s.phone}) ` +
            `ถึงประมาณ ${String(s.arrival_time).slice(0, 5)} น.`
        );
    }
    lines.push("ส่งครบแล้วขับกลับร้าน");
    return lines;
}

/** ใบงานของไรเดอร์ในวันที่กำหนด (เฉพาะแผนที่ยังใช้งาน) */
export async function getRiderJobsOnDate(riderId: number, date: string, conn: Queryable = db) {
    const [rows] = await conn.query(
        `${ROUTE_SELECT}
         WHERE rr.rider_id = ? AND p.delivery_date = ? AND p.status <> 'cancelled' AND rr.status <> 'cancelled'
         ORDER BY p.revision DESC, rr.id`,
        [riderId, date]
    );
    return attachStops(rows as RowDataPacket[], conn);
}

/**
 * หลังส่งของ 1 จุด: อัปเดตสถานะใบงาน และแผน
 *  - ใบงาน: ส่งครบทุกจุด = completed, ส่งไปบางจุด = in_progress
 *  - แผน: ทุกใบงาน completed = completed
 */
export async function refreshRouteAndPlanStatus(routeId: number, conn: Queryable) {
    await conn.query(
        `UPDATE rider_routes rr
         SET rr.status = CASE
             WHEN NOT EXISTS (SELECT 1 FROM route_stops s WHERE s.route_id = rr.id AND s.status = 'pending') THEN 'completed'
             WHEN EXISTS (SELECT 1 FROM route_stops s WHERE s.route_id = rr.id AND s.status = 'delivered') THEN 'in_progress'
             ELSE rr.status END
         WHERE rr.id = ? AND rr.status <> 'cancelled'`,
        [routeId]
    );
    const [rows] = await conn.query("SELECT plan_id FROM rider_routes WHERE id = ?", [routeId]);
    const planId = (rows as { plan_id: number }[])[0]?.plan_id;
    if (planId === undefined) return;
    await conn.query(
        `UPDATE delivery_plans p
         SET p.status = 'completed'
         WHERE p.id = ? AND p.status = 'active'
           AND NOT EXISTS (
               SELECT 1 FROM rider_routes x WHERE x.plan_id = p.id AND x.status NOT IN ('completed', 'cancelled')
           )`,
        [planId]
    );
}
