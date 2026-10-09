import { Request, Response } from "express";
import { db } from "../config/dbconnect";
import { getSettings } from "../services/settingsService";
import { BOX_CAPACITY_PER_RIDER, LATE_PENALTY_PER_ORDER } from "../models/settingsModel";
import { HttpError } from "../utils/http";
import { requireLatLng, requireNumber, requireText } from "../utils/validate";

// GET /api/settings
export const getShopSettings = async (_req: Request, res: Response) => {
    const settings = await getSettings();
    return res.json({
        ...settings,
        box_capacity_per_rider: BOX_CAPACITY_PER_RIDER,
        late_penalty_per_order: LATE_PENALTY_PER_ORDER,
    });
};

// PUT /api/settings  (ส่งมาเฉพาะ field ที่ต้องการแก้)
export const updateShopSettings = async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const current = await getSettings();
    const next = { ...current };

    if (body.shop_name !== undefined) next.shop_name = requireText(body.shop_name, "shop_name", 120);
    if (body.shop_address !== undefined) next.shop_address = String(body.shop_address ?? "").trim().slice(0, 500);
    if (body.shop_latitude !== undefined || body.shop_longitude !== undefined) {
        const p = requireLatLng(body.shop_latitude ?? current.shop_latitude, body.shop_longitude ?? current.shop_longitude);
        next.shop_latitude = p.latitude;
        next.shop_longitude = p.longitude;
    }
    if (body.box_price !== undefined) next.box_price = requireNumber(body.box_price, "box_price", 0, 100000);
    if (body.box_cost !== undefined) next.box_cost = requireNumber(body.box_cost, "box_cost", 0, 100000);
    if (body.rider_base_fee !== undefined) next.rider_base_fee = requireNumber(body.rider_base_fee, "rider_base_fee", 0, 100000);
    if (body.rider_fee_per_km_per_box !== undefined) {
        next.rider_fee_per_km_per_box = requireNumber(body.rider_fee_per_km_per_box, "rider_fee_per_km_per_box", 0, 1000);
    }
    if (body.max_orders_per_rider !== undefined) {
        next.max_orders_per_rider = requireNumber(body.max_orders_per_rider, "max_orders_per_rider", 1, 3, true);
    }
    if (body.max_boxes_per_order !== undefined) {
        next.max_boxes_per_order = requireNumber(body.max_boxes_per_order, "max_boxes_per_order", 1, 3, true);
    }
    if (body.service_minutes_per_stop !== undefined) {
        next.service_minutes_per_stop = requireNumber(body.service_minutes_per_stop, "service_minutes_per_stop", 0, 30, true);
    }
    if (body.service_radius_km !== undefined) {
        next.service_radius_km = requireNumber(body.service_radius_km, "service_radius_km", 0.1, 100);
    }

    if (next.max_orders_per_rider * next.max_boxes_per_order > BOX_CAPACITY_PER_RIDER) {
        throw new HttpError(400, `max_orders_per_rider x max_boxes_per_order must not exceed ${BOX_CAPACITY_PER_RIDER} boxes`);
    }

    await db.query(
        `UPDATE settings
         SET shop_name = ?, shop_address = ?, shop_latitude = ?, shop_longitude = ?,
             box_price = ?, box_cost = ?, rider_base_fee = ?, rider_fee_per_km_per_box = ?,
             max_orders_per_rider = ?, max_boxes_per_order = ?, service_minutes_per_stop = ?,
             service_radius_km = ?
         WHERE id = 1`,
        [
            next.shop_name, next.shop_address, next.shop_latitude, next.shop_longitude,
            next.box_price, next.box_cost, next.rider_base_fee, next.rider_fee_per_km_per_box,
            next.max_orders_per_rider, next.max_boxes_per_order, next.service_minutes_per_stop,
            next.service_radius_km,
        ]
    );

    return res.json({ message: "Settings updated", settings: await getSettings() });
};
