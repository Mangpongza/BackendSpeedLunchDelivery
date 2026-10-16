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
    order_date?: string;
}

export interface UpdateOrderModel {
    customer_id?: number;
    quantity?: number;
    order_date?: string;
    status?: OrderStatus;
}

export interface QuickOrderModel {
    name: string;
    phone: string;
    address?: string;
    latitude: number;
    longitude: number;
    quantity: number;
    order_date?: string;
}
