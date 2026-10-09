import { haversineKm } from "../utils/geo";

/**
 * อัลกอริทึมจัดเส้นทาง (ไม่ยุ่งกับฐานข้อมูล ทดสอบแยกได้)
 *
 * 1. เรียงออเดอร์ตาม "มุม" รอบร้าน (sweep) ทำให้ออเดอร์ที่อยู่ทิศเดียวกันติดกัน
 * 2. ลองทุกจุดเริ่มต้นของวงกลม แล้วใช้ Dynamic Programming แบ่งเป็น k ช่วงต่อเนื่อง
 *    (ช่วงละไม่เกิน max_orders_per_rider จุด และไม่เกิน 10 กล่อง)
 * 3. ในแต่ละช่วงลองทุกลำดับการส่ง (≤3 จุด = ไม่เกิน 6 แบบ) เลือกแบบที่สั้นที่สุด
 * 4. เริ่มจากจำนวนไรเดอร์ขั้นต่ำ ถ้ายังมีจุดที่ส่งไม่ทัน 12:30 ค่อยเพิ่มไรเดอร์ทีละคน
 *    ในแต่ละจำนวนไรเดอร์ เลือกแบบที่ (ก) เลทน้อยที่สุด แล้ว (ข) ค่าส่งรวมถูกที่สุด
 */

export interface PlannerOrder {
    id: number;
    quantity: number;
    latitude: number;
    longitude: number;
}

export interface PlannerOptions {
    shopLat: number;
    shopLng: number;
    minRiders: number;          // จำนวนไรเดอร์ขั้นต่ำที่เจ้าของร้านเลือก
    maxRiders: number;          // จำนวนไรเดอร์ที่มีในระบบ
    maxStopsPerRoute: number;   // settings.max_orders_per_rider
    boxCapacity: number;        // 10 กล่อง/คัน
    speedKmh: number;
    serviceMinutes: number;     // settings.service_minutes_per_stop
    departureMin: number;       // นาทีนับจากเที่ยงคืน เช่น 11:30 = 690
    deadlineMin: number;
    baseFee: number;            // settings.rider_base_fee
    feePerKmPerBox: number;     // settings.rider_fee_per_km_per_box
    latePenalty: number;        // ค่าชดเชยต่อออเดอร์ที่เลท
}

export interface PlannedStop<T extends PlannerOrder> {
    order: T;
    sequence: number;
    distanceFromPreviousKm: number;
    arrivalMin: number;
    late: boolean;
}

export interface PlannedRoute<T extends PlannerOrder> {
    stops: PlannedStop<T>[];
    totalBoxes: number;
    distanceKm: number;       // ร้าน -> จุดสุดท้าย
    returnDistanceKm: number; // จุดสุดท้าย -> กลับร้าน
    durationMinutes: number;  // ออกจากร้านจนส่งจุดสุดท้ายเสร็จ
    deliveryCost: number;
    lateOrders: number;
}

export interface PlanResult<T extends PlannerOrder> {
    routes: PlannedRoute<T>[];
    riderCount: number;
    totalBoxes: number;
    distanceKm: number;
    deliveryCost: number;
    lateOrders: number;
    latePenalty: number;
    lastArrivalMin: number;
}

export class PlannerError extends Error {}

interface Score { late: number; cost: number; }
const INFEASIBLE: Score = { late: Infinity, cost: Infinity };

function better(a: Score, b: Score): boolean {
    if (a.late !== b.late) return a.late < b.late;
    return a.cost < b.cost - 1e-9;
}
function add(a: Score, b: Score): Score {
    return { late: a.late + b.late, cost: a.cost + b.cost };
}

function permutations<X>(items: X[]): X[][] {
    if (items.length <= 1) return [items];
    const out: X[][] = [];
    items.forEach((item, i) => {
        const rest = [...items.slice(0, i), ...items.slice(i + 1)];
        for (const p of permutations(rest)) out.push([item, ...p]);
    });
    return out;
}

/** หาลำดับการส่งที่ดีที่สุดของกลุ่มออเดอร์ 1 กลุ่ม (1 ไรเดอร์) */
export function bestRoute<T extends PlannerOrder>(group: T[], opt: PlannerOptions): PlannedRoute<T> | null {
    const totalBoxes = group.reduce((s, o) => s + Number(o.quantity), 0);
    if (group.length === 0 || group.length > opt.maxStopsPerRoute || totalBoxes > opt.boxCapacity) return null;

    let best: PlannedRoute<T> | null = null;
    let bestScore = INFEASIBLE;

    // ≤3 จุด ลองครบทุกลำดับได้ (มากกว่านั้นใช้ nearest-neighbor)
    const orders = group.length <= 6 ? permutations(group) : [nearestNeighbor(group, opt)];
    for (const seq of orders) {
        let lat = opt.shopLat, lng = opt.shopLng, dist = 0, late = 0;
        const stops: PlannedStop<T>[] = seq.map((o, i) => {
            const d = haversineKm(lat, lng, o.latitude, o.longitude);
            dist += d;
            lat = o.latitude;
            lng = o.longitude;
            // เวลาถึง = เวลาเดินทางสะสม + เวลาส่งของจุดก่อนหน้า
            const arrivalMin = opt.departureMin + (dist / opt.speedKmh) * 60 + opt.serviceMinutes * i;
            const isLate = arrivalMin > opt.deadlineMin;
            if (isLate) late++;
            return { order: o, sequence: i + 1, distanceFromPreviousKm: d, arrivalMin, late: isLate };
        });
        const cost = opt.baseFee + opt.feePerKmPerBox * totalBoxes * dist;
        const score: Score = { late, cost: cost + late * opt.latePenalty };
        if (best === null || better(score, bestScore)) {
            bestScore = score;
            best = {
                stops,
                totalBoxes,
                distanceKm: dist,
                returnDistanceKm: haversineKm(lat, lng, opt.shopLat, opt.shopLng),
                durationMinutes: (dist / opt.speedKmh) * 60 + opt.serviceMinutes * seq.length,
                deliveryCost: cost,
                lateOrders: late,
            };
        }
    }
    return best;
}

function nearestNeighbor<T extends PlannerOrder>(group: T[], opt: PlannerOptions): T[] {
    const remaining = [...group];
    const out: T[] = [];
    let lat = opt.shopLat, lng = opt.shopLng;
    while (remaining.length > 0) {
        let bi = 0, bd = Infinity;
        remaining.forEach((o, i) => {
            const d = haversineKm(lat, lng, o.latitude, o.longitude);
            if (d < bd) { bd = d; bi = i; }
        });
        const p = remaining.splice(bi, 1)[0]!;
        out.push(p);
        lat = p.latitude;
        lng = p.longitude;
    }
    return out;
}

function routeScore<T extends PlannerOrder>(r: PlannedRoute<T> | null, opt: PlannerOptions): Score {
    if (!r) return INFEASIBLE;
    return { late: r.lateOrders, cost: r.deliveryCost + r.lateOrders * opt.latePenalty };
}

/** แบ่งลำดับ seq เป็น k ช่วงต่อเนื่องที่ดีที่สุดด้วย DP */
function splitIntoRoutes<T extends PlannerOrder>(seq: T[], k: number, opt: PlannerOptions, cache: Map<string, PlannedRoute<T> | null>) {
    const n = seq.length;
    const L = opt.maxStopsPerRoute;
    // dp[j][i] = คะแนนดีที่สุดของการใช้ j ไรเดอร์ส่ง i ออเดอร์แรก
    const dp: Score[][] = Array.from({ length: k + 1 }, () => Array<Score>(n + 1).fill(INFEASIBLE));
    const prev: number[][] = Array.from({ length: k + 1 }, () => Array<number>(n + 1).fill(-1));
    dp[0]![0] = { late: 0, cost: 0 };

    const segment = (a: number, b: number) => {
        const group = seq.slice(a, b);
        const key = group.map((o) => o.id).sort((x, y) => x - y).join(",");
        if (!cache.has(key)) cache.set(key, bestRoute(group, opt));
        return cache.get(key)!;
    };

    for (let j = 1; j <= k; j++) {
        for (let i = 1; i <= n; i++) {
            for (let len = 1; len <= L && len <= i; len++) {
                const base = dp[j - 1]![i - len]!;
                if (base.late === Infinity) continue;
                const s = add(base, routeScore(segment(i - len, i), opt));
                if (better(s, dp[j]![i]!)) {
                    dp[j]![i] = s;
                    prev[j]![i] = i - len;
                }
            }
        }
    }
    if (dp[k]![n]!.late === Infinity) return null;

    const routes: PlannedRoute<T>[] = [];
    let i = n;
    for (let j = k; j >= 1; j--) {
        const a = prev[j]![i]!;
        routes.unshift(segment(a, i)!);
        i = a;
    }
    return { score: dp[k]![n]!, routes };
}

export function planRoutes<T extends PlannerOrder>(orders: T[], opt: PlannerOptions): PlanResult<T> {
    if (orders.length === 0) throw new PlannerError("No pending orders");

    const totalBoxes = orders.reduce((s, o) => s + Number(o.quantity), 0);
    const tooBig = orders.find((o) => o.quantity > opt.boxCapacity);
    if (tooBig) throw new PlannerError(`Order ${tooBig.id} has more boxes than one rider can carry`);

    const kMin = Math.max(
        opt.minRiders,
        Math.ceil(orders.length / opt.maxStopsPerRoute),
        Math.ceil(totalBoxes / opt.boxCapacity)
    );
    if (kMin > opt.maxRiders) {
        throw new PlannerError(`Not enough riders (need at least ${kMin}, have ${opt.maxRiders})`);
    }
    const kMax = Math.min(opt.maxRiders, orders.length);

    // เรียงตามมุมรอบร้าน
    const sorted = [...orders].sort((a, b) =>
        Math.atan2(a.latitude - opt.shopLat, a.longitude - opt.shopLng) -
        Math.atan2(b.latitude - opt.shopLat, b.longitude - opt.shopLng)
    );

    const cache = new Map<string, PlannedRoute<T> | null>();
    let best: { score: Score; routes: PlannedRoute<T>[] } | null = null;

    for (let k = kMin; k <= kMax; k++) {
        let bestAtK: { score: Score; routes: PlannedRoute<T>[] } | null = null;
        for (let offset = 0; offset < sorted.length; offset++) {
            const seq = [...sorted.slice(offset), ...sorted.slice(0, offset)];
            const r = splitIntoRoutes(seq, k, opt, cache);
            if (r && (bestAtK === null || better(r.score, bestAtK.score))) bestAtK = r;
        }
        // เลท "น้อยกว่า" เท่านั้นถึงจะยอมเพิ่มไรเดอร์
        if (bestAtK && (best === null || bestAtK.score.late < best.score.late)) best = bestAtK;
        // ใช้ไรเดอร์น้อยที่สุดที่ส่งทันทุกจุด แล้วหยุด
        if (best && best.score.late === 0) break;
    }
    if (!best) throw new PlannerError("Cannot build a plan with the current settings");

    const routes = best.routes;
    const lateOrders = routes.reduce((s, r) => s + r.lateOrders, 0);
    return {
        routes,
        riderCount: routes.length,
        totalBoxes,
        distanceKm: routes.reduce((s, r) => s + r.distanceKm, 0),
        deliveryCost: routes.reduce((s, r) => s + r.deliveryCost, 0),
        lateOrders,
        latePenalty: lateOrders * opt.latePenalty,
        lastArrivalMin: Math.max(opt.departureMin, ...routes.flatMap((r) => r.stops.map((s) => s.arrivalMin))),
    };
}
