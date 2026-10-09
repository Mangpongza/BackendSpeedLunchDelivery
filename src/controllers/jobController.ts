import { Request, Response } from "express";
import { db } from "../config/dbconnect";
import { getJobDetail } from "../deliveryPlanService";
import { HttpError } from "../errorHandler";
import { isValidDateStr } from "../validation";

// GET /api/jobs?search=&date=&status=&include_cancelled=true
export const getJobs = async (req: Request, res: Response) => {
  const search = String(req.query.search ?? "").trim();
  const date = String(req.query.date ?? "").trim();
  const status = String(req.query.status ?? "").trim();
  const includeCancelled = String(req.query.include_cancelled ?? "") === "true";

  let sql = `
      SELECT rr.job_code, p.delivery_date, p.id AS plan_id, p.revision,
             rr.id AS route_id, rr.rider_number, rr.rider_id,
             r.name AS rider_name, r.phone AS rider_phone,
             rr.total_boxes, rr.distance_km, rr.duration_minutes,
             rr.delivery_cost, rr.navigation_url, rr.status,
             (SELECT COUNT(*) FROM route_stops rs WHERE rs.route_id = rr.id) AS total_orders,
             (SELECT COUNT(*) FROM route_stops rs WHERE rs.route_id = rr.id AND rs.status = 'delivered') AS delivered_orders
      FROM rider_routes rr
      JOIN delivery_plans p ON p.id = rr.plan_id
      JOIN riders r ON r.id = rr.rider_id
      WHERE 1=1`;
  const params: unknown[] = [];
  if (!includeCancelled && !status) sql += ` AND rr.status <> 'cancelled'`;
  if (search) {
    sql += ` AND (rr.job_code LIKE ? OR r.name LIKE ? OR r.phone LIKE ?)`;
    const like = `%${search}%`;
    params.push(like, like, like);
  }
  if (date) {
    if (!isValidDateStr(date)) throw new HttpError(400, "Invalid date (YYYY-MM-DD)");
    sql += ` AND p.delivery_date = ?`;
    params.push(date);
  }
  if (status) {
    if (!["assigned", "in_progress", "completed", "cancelled"].includes(status)) {
      throw new HttpError(400, "status must be assigned, in_progress, completed or cancelled");
    }
    sql += ` AND rr.status = ?`;
    params.push(status);
  }
  sql += ` ORDER BY rr.id DESC LIMIT 100`;
  const [rows] = await db.query(sql, params);
  return res.json(rows);
};

// GET /api/jobs/:code
export const getJobByCode = async (req: Request, res: Response) => {
  return res.json(await getJobDetail(String(req.params.code)));
};
