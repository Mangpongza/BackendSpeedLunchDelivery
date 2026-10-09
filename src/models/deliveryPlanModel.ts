export type PlanStatus = "active" | "completed" | "cancelled";
export type RouteStatus = "assigned" | "in_progress" | "completed" | "cancelled";
export type StopStatus = "pending" | "delivered" | "cancelled";

export interface PendingOrderRow {
  id: number;
  customer_id: number;
  quantity: number;
  order_date: string;
  customer_name: string;
  phone: string;
  address: string;
  latitude: string | number;
  longitude: string | number;
}

export interface CalculatePlanBody {
  delivery_date?: string;   // ไม่ส่ง = วันนี้
  rider_count?: number;     // จำนวนไรเดอร์ขั้นต่ำ ระบบจะเพิ่มให้เองถ้าไม่พอ/ส่งไม่ทัน
  departure_time?: string;  // ค่าเริ่มต้น 11:30:00
  deadline_time?: string;   // ค่าเริ่มต้น 12:30:00
  speed_kmh?: number;       // ค่าเริ่มต้น 30
  service_minutes?: number; // ค่าเริ่มต้นจาก settings.service_minutes_per_stop
}

export interface DeliveryPlanModel {
  id: number;
  settings_id: number;
  delivery_date: string;
  revision: number;
  status: PlanStatus;
  departure_time: string;
  deadline_time: string;
  rider_count: number;
  total_orders: number;
  total_boxes: number;
  distance_km: number;
  delivery_cost: number;
  revenue: number;
  food_cost: number;
  late_orders: number;
  late_penalty: number;
  profit: number;
  last_arrival_time: string;
  all_on_time: boolean;
  created_at: string;
  routes?: RiderRouteDetail[];
}

export interface RiderRouteDetail {
  route_id: number;
  plan_id: number;
  job_code: string;
  rider_number: number;
  rider_id: number;
  rider_name: string;
  rider_phone: string;
  total_boxes: number;
  total_orders: number;
  delivered_orders: number;
  distance_km: number;
  duration_minutes: number;
  delivery_cost: number;
  geometry: [number, number][];
  navigation_url: string;
  status: RouteStatus;
  stops: RouteStopDetail[];
}

export interface RouteStopDetail {
  stop_id: number;
  route_id: number;
  order_id: number;
  stop_sequence: number;
  distance_from_previous_km: number;
  arrival_time: string;
  status: StopStatus;
  delivered_at: string | null;
  quantity: number;
  customer_id: number;
  customer_name: string;
  phone: string;
  address: string;
  latitude: number;
  longitude: number;
}
