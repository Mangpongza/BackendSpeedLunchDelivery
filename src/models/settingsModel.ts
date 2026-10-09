export interface SettingsModel {
    id: number;
    shop_name: string;
    shop_address: string;
    shop_latitude: number;
    shop_longitude: number;
    box_price: number;
    box_cost: number;
    rider_base_fee: number;
    rider_fee_per_km_per_box: number;
    max_orders_per_rider: number;
    max_boxes_per_order: number;
    service_minutes_per_stop: number;
    service_radius_km: number;
}

export type UpdateSettingsModel = Partial<Omit<SettingsModel, "id">>;

/** มอเตอร์ไซค์ 1 คันขนได้สูงสุด 10 กล่อง (โจทย์) */
export const BOX_CAPACITY_PER_RIDER = 10;

/** ส่งเลยเวลา ร้านต้องจ่ายค่าชดเชยออเดอร์ละ 20 บาท (โจทย์) */
export const LATE_PENALTY_PER_ORDER = 20;
