import { HttpError } from "./http";

export const TIMEZONE = process.env.TZ_NAME ?? "Asia/Bangkok";

/** วันที่วันนี้ตามเวลาไทย รูปแบบ YYYY-MM-DD */
export function todayStr(): string {
    return new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(new Date());
}

export function isValidDateStr(s: string): boolean {
    return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
}

export function isValidTimeStr(s: string): boolean {
    return /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(s);
}

export function normalizeTime(t: string): string {
    const p = String(t).split(":");
    return `${(p[0] ?? "00").padStart(2, "0")}:${(p[1] ?? "00").padStart(2, "0")}:${(p[2] ?? "00").padStart(2, "0")}`;
}

export function timeToMinutes(t: string): number {
    const [h = "0", m = "0", s = "0"] = String(t).split(":");
    return Number(h) * 60 + Number(m) + Number(s) / 60;
}

export function minutesToTimeString(totalMinutes: number): string {
    const m = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
    return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}:00`;
}

/** อ่าน query/body date ถ้าไม่ส่งมาใช้วันนี้ */
export function dateOrToday(value: unknown, field = "date"): string {
    const s = String(value ?? "").trim();
    if (!s) return todayStr();
    if (!isValidDateStr(s)) throw new HttpError(400, `Invalid ${field} (YYYY-MM-DD)`);
    return s;
}

export function requireId(value: unknown, field = "id"): number {
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `Invalid ${field}`);
    return n;
}

export function requireText(value: unknown, field: string, max: number): string {
    const s = String(value ?? "").trim();
    if (!s) throw new HttpError(400, `${field} is required`);
    if (s.length > max) throw new HttpError(400, `${field} must be at most ${max} characters`);
    return s;
}

/** เบอร์โทรไทย: เก็บเฉพาะตัวเลข 9–10 หลัก */
export function normalizePhone(value: unknown): string {
    const digits = String(value ?? "").replace(/[^0-9]/g, "");
    if (!/^0\d{8,9}$/.test(digits)) {
        throw new HttpError(400, "phone must be a Thai phone number such as 0812345678");
    }
    return digits;
}

export function requireLatLng(lat: unknown, lng: unknown): { latitude: number; longitude: number } {
    const latitude = Number(lat);
    const longitude = Number(lng);
    if (lat === null || lat === undefined || lat === "" || !Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
        throw new HttpError(400, "latitude must be between -90 and 90");
    }
    if (lng === null || lng === undefined || lng === "" || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
        throw new HttpError(400, "longitude must be between -180 and 180");
    }
    return { latitude, longitude };
}

export function requireNumber(value: unknown, field: string, min: number, max: number, integer = false): number {
    const n = Number(value);
    if (value === null || value === undefined || value === "" || !Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) {
        throw new HttpError(400, `${field} must be ${integer ? "an integer " : ""}between ${min} and ${max}`);
    }
    return n;
}
