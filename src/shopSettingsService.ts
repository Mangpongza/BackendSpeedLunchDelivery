import type { Pool } from "mysql2/promise";
import { db } from "./config/dbconnect";
import { SettingsModel } from "./models/settingsModel";
import { HttpError } from "./errorHandler";
import { haversineKm, round } from "./distanceCalculator";

type Queryable = Pick<Pool, "query">;

export async function getSettings(conn: Queryable = db): Promise<SettingsModel> {
    const [rows] = await conn.query("SELECT * FROM settings WHERE id = 1");
    const list = rows as SettingsModel[];
    if (list.length === 0) throw new HttpError(500, "Shop settings not configured (import sqlschema.sql)");
    const s = list[0]!;
    // แปลงให้เป็น number เสมอ
    return {
        ...s,
        shop_latitude: Number(s.shop_latitude),
        shop_longitude: Number(s.shop_longitude),
        box_price: Number(s.box_price),
        box_cost: Number(s.box_cost),
        rider_base_fee: Number(s.rider_base_fee),
        rider_fee_per_km_per_box: Number(s.rider_fee_per_km_per_box),
        max_orders_per_rider: Number(s.max_orders_per_rider),
        max_boxes_per_order: Number(s.max_boxes_per_order),
        service_minutes_per_stop: Number(s.service_minutes_per_stop),
        service_radius_km: Number(s.service_radius_km),
    };
}

export function distanceFromShopKm(settings: SettingsModel, latitude: number, longitude: number): number {
    return round(haversineKm(settings.shop_latitude, settings.shop_longitude, latitude, longitude), 3);
}

/** ปฏิเสธพิกัดที่อยู่นอกพื้นที่ให้บริการ */
export function assertInServiceArea(settings: SettingsModel, latitude: number, longitude: number): number {
    const d = distanceFromShopKm(settings, latitude, longitude);
    if (d > settings.service_radius_km) {
        throw new HttpError(400, `Location is ${d} km from the shop, outside service radius (${settings.service_radius_km} km)`);
    }
    return d;
}
