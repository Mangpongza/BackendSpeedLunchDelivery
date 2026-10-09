export type OrderStatus = "pending" | "delivered" | "cancelled";
export const ORDER_STATUSES: OrderStatus[] = ["pending", "delivered", "cancelled"];

export interface OrderModel {
    id:          number;
    customer_id: number;
    quantity:    number;
    order_date:  string;
    status:      OrderStatus;
    is_demo:     number;
}

export interface CreateOrderModel {
    customer_id: number;
    quantity: number;
    order_date?: string; // ไม่ส่ง = วันนี้
}

export interface UpdateOrderModel {
    customer_id?: number;
    quantity?: number;
    order_date?: string;
    status?: OrderStatus;
}

/** ฟอร์มเจ้าของร้าน: กรอกข้อมูลลูกค้า + จำนวนกล่อง ในครั้งเดียว */
export interface QuickOrderModel {
    name: string;
    phone: string;
    address?: string;
    latitude: number;
    longitude: number;
    quantity: number;
    order_date?: string;
}
