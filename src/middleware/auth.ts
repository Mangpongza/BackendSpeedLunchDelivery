import { createHmac, timingSafeEqual } from "crypto";
import { NextFunction, Request, Response } from "express";
import { HttpError } from "../utils/http";

// token แบบง่าย (คล้าย JWT) ใช้ crypto ที่มากับ Node ไม่ต้องลงแพ็กเกจเพิ่ม
// รูปแบบ: base64url(payload).base64url(hmac-sha256)

// อ่านค่าตอนใช้งาน (หลัง dotenv.config() ทำงานแล้ว)
let warned = false;
function secret(): string {
    if (!process.env.AUTH_SECRET && !warned) {
        console.warn("[auth] AUTH_SECRET is not set in .env, using an insecure default");
        warned = true;
    }
    return process.env.AUTH_SECRET || "change-me-in-.env";
}

export interface RiderTokenPayload {
    rider_id: number;
    role: "rider";
    exp: number; // unix seconds
}

function sign(data: string): string {
    return createHmac("sha256", secret()).update(data).digest("base64url");
}

export function createRiderToken(riderId: number): { token: string; expires_at: string } {
    const hours = Number(process.env.AUTH_TOKEN_HOURS ?? 24) || 24;
    const exp = Math.floor(Date.now() / 1000) + hours * 3600;
    const payload: RiderTokenPayload = { rider_id: riderId, role: "rider", exp };
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return { token: `${body}.${sign(body)}`, expires_at: new Date(exp * 1000).toISOString() };
}

export function verifyRiderToken(token: string): RiderTokenPayload {
    const [body, signature] = token.split(".");
    if (!body || !signature) throw new HttpError(401, "Invalid token");
    const expected = Buffer.from(sign(body));
    const actual = Buffer.from(signature);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
        throw new HttpError(401, "Invalid token");
    }
    let payload: RiderTokenPayload;
    try {
        payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    } catch {
        throw new HttpError(401, "Invalid token");
    }
    if (payload.role !== "rider" || !payload.rider_id) throw new HttpError(401, "Invalid token");
    if (payload.exp * 1000 < Date.now()) throw new HttpError(401, "Token expired, please login again");
    return payload;
}

/** ใช้กับเส้น /api/me/* ต้องส่ง header Authorization: Bearer <token> */
export const requireRider = (req: Request, res: Response, next: NextFunction) => {
    const header = String(req.headers.authorization ?? "");
    const match = /^Bearer\s+(.+)$/i.exec(header);
    if (!match || !match[1]) {
        throw new HttpError(401, "Missing Authorization: Bearer <token>");
    }
    res.locals.riderId = verifyRiderToken(match[1].trim()).rider_id;
    next();
};
