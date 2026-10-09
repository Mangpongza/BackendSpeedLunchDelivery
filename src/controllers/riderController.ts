import { Request, Response } from "express";
import { ResultSetHeader } from "mysql2";
import { db } from "../config/dbconnect";
import { RiderModel } from "../models/riderModel";
import { HttpError } from "../errorHandler";
import { dateOrToday, normalizePhone, requireId, requireText } from "../validation";

// GET /api/riders?search=คำค้น&date=YYYY-MM-DD
// ส่งจำนวนงานในวันนั้นกลับไปด้วย เพื่อให้หน้าเจ้าของร้านเห็นว่าใครว่าง
export const getRiders = async (req: Request, res: Response) => {
    const search = String(req.query.search ?? "").trim();
    const date = dateOrToday(req.query.date);
    const params: unknown[] = [date];
    let sql = `
        SELECT r.id, r.name, r.phone,
               COUNT(rr.id) AS jobs_on_date
        FROM riders r
        LEFT JOIN rider_routes rr
               ON rr.rider_id = r.id AND rr.status <> 'cancelled'
              AND rr.plan_id IN (SELECT id FROM delivery_plans WHERE delivery_date = ? AND status <> 'cancelled')`;
    if (search) {
        sql += ` WHERE r.name LIKE ? OR r.phone LIKE ?`;
        params.push(`%${search}%`, `%${search}%`);
    }
    sql += ` GROUP BY r.id ORDER BY r.id`;
    const [rows] = await db.query(sql, params);
    return res.json(rows);
};

// GET /api/riders/:id
export const getRiderByID = async (req: Request, res: Response) => {
    const id = requireId(req.params.id);
    const [rows] = await db.query("SELECT id, name, phone FROM riders WHERE id = ?", [id]);
    const riders = rows as RiderModel[];
    if (riders.length === 0) throw new HttpError(404, "Rider not found");
    return res.json(riders[0]);
};

// POST /api/riders
export const createRider = async (req: Request, res: Response) => {
    const name = requireText(req.body?.name, "name", 120);
    const phone = normalizePhone(req.body?.phone);
    const [result] = await db.query<ResultSetHeader>(
        "INSERT INTO riders (name, phone) VALUES (?, ?)",
        [name, phone]
    );
    return res.status(201).json({ affected_rows: result.affectedRows, last_id: result.insertId });
};

// PUT /api/riders/:id
export const updateRiderByID = async (req: Request, res: Response) => {
    const id = requireId(req.params.id);
    const name = requireText(req.body?.name, "name", 120);
    const phone = normalizePhone(req.body?.phone);
    const [result] = await db.query<ResultSetHeader>(
        "UPDATE riders SET name = ?, phone = ? WHERE id = ?",
        [name, phone, id]
    );
    if (result.affectedRows === 0) throw new HttpError(404, "Rider not found");
    return res.json({ affected_rows: result.affectedRows });
};

// DELETE /api/riders/:id  (ลบไม่ได้ถ้ามีใบงานอยู่แล้ว เพื่อเก็บประวัติ)
export const deleteRiderByID = async (req: Request, res: Response) => {
    const id = requireId(req.params.id);
    const [used] = await db.query("SELECT COUNT(*) AS n FROM rider_routes WHERE rider_id = ?", [id]);
    if (Number((used as { n: number }[])[0]?.n ?? 0) > 0) {
        throw new HttpError(409, "Rider already has delivery jobs and cannot be deleted");
    }
    const [result] = await db.query<ResultSetHeader>("DELETE FROM riders WHERE id = ?", [id]);
    if (result.affectedRows === 0) throw new HttpError(404, "Rider not found");
    return res.json({ message: "Rider deleted", affected_rows: result.affectedRows });
};
