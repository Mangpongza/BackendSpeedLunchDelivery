import { Request, Response } from "express";
import { db } from "../config/dbconnect";
import { createRiderToken } from "../riderAuth";
import { RiderModel } from "../models/riderModel";
import { HttpError } from "../errorHandler";
import { normalizePhone } from "../validation";

// POST /api/auth/rider-login  { "phone": "0810000001" }
// ไรเดอร์ล็อกอินด้วยเบอร์โทรที่ร้านลงทะเบียนไว้ ได้ token ไปใช้กับเส้น /api/me/*
export const riderLogin = async (req: Request, res: Response) => {
    const phone = normalizePhone(req.body?.phone);
    const [rows] = await db.query("SELECT id, name, phone FROM riders WHERE phone = ?", [phone]);
    const riders = rows as RiderModel[];
    if (riders.length === 0) throw new HttpError(401, "Phone number is not registered as a rider");
    const rider = riders[0]!;
    const { token, expires_at } = createRiderToken(rider.id);
    return res.json({ token, token_type: "Bearer", expires_at, rider });
};
