-- SpeedLunchDelivery schema (ตรงกับ ER Diagram "SpeedLunchDelivery-Final")
-- ตาราง: settings, customers, orders, riders, delivery_plans, rider_routes, route_stops
--
-- คอลัมน์ที่ "เพิ่มจาก ER" (จำเป็นต่อการทำงาน ควรเติมใน ER ด้วย):
--   orders.customer_id (FK จากความสัมพันธ์ places), orders.status
--   delivery_plans.settings_id (FK จาก uses), delivery_date, departure_time, deadline_time,
--                 rider_count, all_on_time, late_orders, late_penalty, created_at
--   rider_routes.plan_id / rider_id (FK จาก contains / assigned to), duration_minutes
--   route_stops.route_id / order_id (FK จาก has stops / scheduled as), arrival_time

CREATE DATABASE IF NOT EXISTS speed_lunch_delivery
CHARACTER SET utf8mb4
COLLATE utf8mb4_unicode_ci;

USE speed_lunch_delivery;

-- ร้านมีร้านเดียว (id = 1) เก็บพิกัดร้าน ราคา ต้นทุน และกติกาการจัดส่ง
CREATE TABLE settings (
    id TINYINT UNSIGNED NOT NULL DEFAULT 1,
    shop_name VARCHAR(120) NOT NULL,
    shop_address VARCHAR(500) NOT NULL DEFAULT '',
    shop_latitude DECIMAL(10, 7) NOT NULL,
    shop_longitude DECIMAL(10, 7) NOT NULL,
    box_price DECIMAL(10, 2) NOT NULL DEFAULT 65.00,
    box_cost DECIMAL(10, 2) NOT NULL DEFAULT 40.00,
    rider_base_fee DECIMAL(10, 2) NOT NULL DEFAULT 15.00,
    rider_fee_per_km_per_box DECIMAL(10, 2) NOT NULL DEFAULT 2.00,
    max_orders_per_rider TINYINT UNSIGNED NOT NULL DEFAULT 3,
    max_boxes_per_order TINYINT UNSIGNED NOT NULL DEFAULT 3,
    service_minutes_per_stop TINYINT UNSIGNED NOT NULL DEFAULT 2,
    service_radius_km DECIMAL(6, 2) NOT NULL DEFAULT 10.00,
    PRIMARY KEY (id),
    CONSTRAINT chk_single_settings CHECK (id = 1),
    CONSTRAINT chk_settings_latitude CHECK (shop_latitude BETWEEN -90 AND 90),
    CONSTRAINT chk_settings_longitude CHECK (shop_longitude BETWEEN -180 AND 180),
    CONSTRAINT chk_settings_prices CHECK (
        box_price >= 0
        AND box_cost >= 0
        AND rider_base_fee >= 0
        AND rider_fee_per_km_per_box >= 0
    ),
    CONSTRAINT chk_settings_max_orders CHECK (max_orders_per_rider BETWEEN 1 AND 3),
    CONSTRAINT chk_settings_max_boxes CHECK (max_boxes_per_order BETWEEN 1 AND 3),
    CONSTRAINT chk_settings_service CHECK (service_minutes_per_stop <= 30),
    CONSTRAINT chk_settings_radius CHECK (service_radius_km > 0)
) ENGINE = InnoDB;

CREATE TABLE customers (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    name VARCHAR(120) NOT NULL,
    phone VARCHAR(25) NOT NULL,
    address VARCHAR(500) NOT NULL DEFAULT '',
    latitude DECIMAL(10, 7) NOT NULL,
    longitude DECIMAL(10, 7) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_customers_phone (phone),
    INDEX idx_customers_name (name),
    CONSTRAINT chk_customer_latitude CHECK (latitude BETWEEN -90 AND 90),
    CONSTRAINT chk_customer_longitude CHECK (longitude BETWEEN -180 AND 180)
) ENGINE = InnoDB;

CREATE TABLE riders (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    name VARCHAR(120) NOT NULL,
    phone VARCHAR(25) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_riders_phone (phone),
    INDEX idx_riders_name (name)
) ENGINE = InnoDB;

CREATE TABLE orders (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    customer_id BIGINT UNSIGNED NOT NULL,
    quantity TINYINT UNSIGNED NOT NULL,
    order_date DATE NOT NULL,
    status ENUM('pending', 'delivered', 'cancelled') NOT NULL DEFAULT 'pending',
    is_demo BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (id),
    INDEX idx_orders_date_status (order_date, status),
    INDEX idx_orders_customer (customer_id),
    CONSTRAINT fk_orders_customer
        FOREIGN KEY (customer_id)
        REFERENCES customers(id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,
    CONSTRAINT chk_order_quantity CHECK (quantity BETWEEN 1 AND 3)
) ENGINE = InnoDB;

-- revision = ครั้งที่กด "จัดเส้นทาง" ของวันนั้น (แผนเก่าจะถูกเปลี่ยนเป็น cancelled)
CREATE TABLE delivery_plans (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    settings_id TINYINT UNSIGNED NOT NULL DEFAULT 1,
    delivery_date DATE NOT NULL,
    revision SMALLINT UNSIGNED NOT NULL DEFAULT 1,
    status ENUM('active', 'completed', 'cancelled') NOT NULL DEFAULT 'active',
    departure_time TIME NOT NULL DEFAULT '11:30:00',
    deadline_time TIME NOT NULL DEFAULT '12:30:00',
    rider_count SMALLINT UNSIGNED NOT NULL,
    total_orders SMALLINT UNSIGNED NOT NULL,
    total_boxes SMALLINT UNSIGNED NOT NULL,
    distance_km DECIMAL(10, 2) NOT NULL,
    delivery_cost DECIMAL(12, 2) NOT NULL,
    revenue DECIMAL(12, 2) NOT NULL,
    food_cost DECIMAL(12, 2) NOT NULL,
    late_orders SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    late_penalty DECIMAL(12, 2) NOT NULL DEFAULT 0,
    profit DECIMAL(12, 2) NOT NULL,
    last_arrival_time TIME NOT NULL,
    all_on_time BOOLEAN NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uq_plan_date_revision (delivery_date, revision),
    INDEX idx_plans_date_status (delivery_date, status),
    CONSTRAINT fk_plans_settings
        FOREIGN KEY (settings_id)
        REFERENCES settings(id)
        ON UPDATE RESTRICT
        ON DELETE RESTRICT,
    CONSTRAINT chk_plan_time CHECK (deadline_time > departure_time),
    CONSTRAINT chk_plan_rider_count CHECK (rider_count > 0),
    CONSTRAINT chk_plan_orders CHECK (total_orders > 0),
    CONSTRAINT chk_plan_boxes CHECK (total_boxes > 0),
    CONSTRAINT chk_plan_distance CHECK (distance_km >= 0),
    CONSTRAINT chk_plan_cost CHECK (
        delivery_cost >= 0
        AND revenue >= 0
        AND food_cost >= 0
        AND late_penalty >= 0
    )
) ENGINE = InnoDB;

-- ใบงานของไรเดอร์ 1 คนในแผน 1 แผน
CREATE TABLE rider_routes (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    plan_id BIGINT UNSIGNED NOT NULL,
    rider_id BIGINT UNSIGNED NOT NULL,
    rider_number SMALLINT UNSIGNED NOT NULL,
    job_code VARCHAR(32)
        CHARACTER SET ascii
        COLLATE ascii_bin
        NOT NULL,
    total_boxes SMALLINT UNSIGNED NOT NULL,
    distance_km DECIMAL(10, 2) NOT NULL,
    duration_minutes SMALLINT UNSIGNED NOT NULL,
    delivery_cost DECIMAL(12, 2) NOT NULL,
    geometry JSON NOT NULL,
    navigation_url TEXT NOT NULL,
    status ENUM('assigned', 'in_progress', 'completed', 'cancelled') NOT NULL DEFAULT 'assigned',
    PRIMARY KEY (id),
    UNIQUE KEY uq_route_job_code (job_code),
    UNIQUE KEY uq_route_plan_number (plan_id, rider_number),
    UNIQUE KEY uq_route_plan_rider (plan_id, rider_id),
    INDEX idx_routes_rider_status (rider_id, status),
    CONSTRAINT fk_routes_plan
        FOREIGN KEY (plan_id)
        REFERENCES delivery_plans(id)
        ON UPDATE CASCADE
        ON DELETE CASCADE,
    CONSTRAINT fk_routes_rider
        FOREIGN KEY (rider_id)
        REFERENCES riders(id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,
    CONSTRAINT chk_rider_number CHECK (rider_number > 0),
    CONSTRAINT chk_route_boxes CHECK (total_boxes BETWEEN 1 AND 10),
    CONSTRAINT chk_route_distance CHECK (distance_km >= 0),
    CONSTRAINT chk_route_cost CHECK (delivery_cost >= 0)
) ENGINE = InnoDB;

-- จุดส่ง 1–3 จุดต่อใบงาน (ข้อมูลลูกค้าดึงผ่าน orders -> customers)
CREATE TABLE route_stops (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    route_id BIGINT UNSIGNED NOT NULL,
    order_id BIGINT UNSIGNED NOT NULL,
    stop_sequence TINYINT UNSIGNED NOT NULL,
    distance_from_previous_km DECIMAL(10, 2) NOT NULL,
    arrival_time TIME NOT NULL,
    status ENUM('pending', 'delivered', 'cancelled') NOT NULL DEFAULT 'pending',
    delivered_at DATETIME NULL DEFAULT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_stop_sequence (route_id, stop_sequence),
    INDEX idx_stops_order (order_id),
    CONSTRAINT fk_stops_route
        FOREIGN KEY (route_id)
        REFERENCES rider_routes(id)
        ON UPDATE CASCADE
        ON DELETE CASCADE,
    CONSTRAINT fk_stops_order
        FOREIGN KEY (order_id)
        REFERENCES orders(id)
        ON UPDATE CASCADE
        ON DELETE CASCADE,
    CONSTRAINT chk_stop_sequence CHECK (stop_sequence BETWEEN 1 AND 3),
    CONSTRAINT chk_stop_distance CHECK (distance_from_previous_km >= 0)
) ENGINE = InnoDB;

INSERT INTO settings (
    id, shop_name, shop_address, shop_latitude, shop_longitude,
    box_price, box_cost, rider_base_fee, rider_fee_per_km_per_box,
    max_orders_per_rider, max_boxes_per_order, service_minutes_per_stop, service_radius_km
)
VALUES (
    1, 'SpeedLunchDelivery', 'มหาวิทยาลัยมหาสารคาม', 16.2462000, 103.2501000,
    65.00, 40.00, 15.00, 2.00,
    3, 3, 2, 10.00
)
ON DUPLICATE KEY UPDATE id = id;

-- ไรเดอร์ตัวอย่าง 10 คน (ล็อกอินด้วยเบอร์โทร)
-- 30 ออเดอร์ x ไม่เกิน 3 จุด/คน ต้องใช้ไรเดอร์อย่างน้อย 10 คน
INSERT IGNORE INTO riders (name, phone) VALUES
    ('ไรเดอร์ 1', '0810000001'),
    ('ไรเดอร์ 2', '0810000002'),
    ('ไรเดอร์ 3', '0810000003'),
    ('ไรเดอร์ 4', '0810000004'),
    ('ไรเดอร์ 5', '0810000005'),
    ('ไรเดอร์ 6', '0810000006'),
    ('ไรเดอร์ 7', '0810000007'),
    ('ไรเดอร์ 8', '0810000008'),
    ('ไรเดอร์ 9', '0810000009'),
    ('ไรเดอร์ 10', '0810000010');
