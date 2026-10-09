import { Request, Response } from "express";
import { ResultSetHeader, RowDataPacket } from "mysql2";
import { db } from "../config/dbconnect";
import { RiderModel } from "../models/riderModel";
import { getJobDetail, getRiderJobsOnDate, refreshRouteAndPlanStatus } from "../services/planService";
import { HttpError } from "../utils/http";
import { dateOrToday, requireId } from "../utils/validate";

// เส้นทั้งหมดในไฟล์นี้ต้องล็อกอิน (requireRider) -> res.locals.riderId

// GET /api/me
export const getMe = async (_req: Request, res: Response) => {
    const [rows] = await db.query("SELECT id, name, phone FROM riders WHERE id = ?", [res.locals.riderId]);
    const riders = rows as RiderModel[];
    if (riders.length === 0) throw new HttpError(401, "Rider no longer exists");
    return res.json(riders[0]);
};

// GET /api/me/jobs?date=YYYY-MM-DD  (ไม่ส่ง = วันนี้)  ใบงานของฉันในวันนั้น
export const getMyJobs = async (req: Request, res: Response) => {
    const date = dateOrToday(req.query.date);
    const jobs = await getRiderJobsOnDate(res.locals.riderId, date);
    return res.json({
        delivery_date: date,
        total_jobs: jobs.length,
        total_boxes: jobs.reduce((s, j) => s + Number(j.total_boxes), 0),
        jobs,
    });
};

// GET /api/me/jobs/:code  ใบงาน + ข้อความสรุปจุดส่งทีละจุด + ลิงก์นำทาง
export const getMyJobByCode = async (req: Request, res: Response) => {
    return res.json(await getJobDetail(String(req.params.code), res.locals.riderId));
};

// PATCH /api/me/jobs/:code/start  กดเริ่มออกส่ง
export const startMyJob = async (req: Request, res: Response) => {
    const job = await getJobDetail(String(req.params.code), res.locals.riderId);
    if (job.status === "cancelled") throw new HttpError(409, "This job was cancelled, please refresh your jobs");
    if (job.status !== "assigned") throw new HttpError(400, `Job is already ${job.status}`);
    await db.query("UPDATE rider_routes SET status = 'in_progress' WHERE id = ?", [job.route_id]);
    return res.json({ message: "Job started", job_code: job.job_code, status: "in_progress" });
};

// PATCH /api/me/jobs/:code/stops/:sequence/deliver  กดยืนยันส่งของจุดนี้แล้ว
export const deliverMyStop = async (req: Request, res: Response) => {
    const code = String(req.params.code);
    const sequence = requireId(req.params.sequence, "stop sequence");
    const riderId: number = res.locals.riderId;

    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        const [rows] = await conn.query<RowDataPacket[]>(
            `SELECT rs.id AS stop_id, rs.status, rs.order_id, rr.id AS route_id,
                    rr.rider_id, rr.status AS route_status
             FROM route_stops rs
             JOIN rider_routes rr ON rr.id = rs.route_id
             WHERE rr.job_code = ? AND rs.stop_sequence = ?
             FOR UPDATE`,
            [code, sequence]
        );
        const stop = rows[0];
        if (!stop) throw new HttpError(404, "Stop not found");
        if (stop.rider_id !== riderId) throw new HttpError(403, "This job belongs to another rider");
        if (stop.route_status === "cancelled") throw new HttpError(409, "This job was cancelled");
        if (stop.status === "delivered") throw new HttpError(400, "This stop is already delivered");

        await conn.query<ResultSetHeader>(
            "UPDATE route_stops SET status = 'delivered', delivered_at = NOW() WHERE id = ?",
            [stop.stop_id]
        );
        await conn.query("UPDATE orders SET status = 'delivered' WHERE id = ?", [stop.order_id]);
        await refreshRouteAndPlanStatus(Number(stop.route_id), conn);
        await conn.commit();
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }

    return res.json({ message: "Stop delivered", job: await getJobDetail(code, riderId) });
};
