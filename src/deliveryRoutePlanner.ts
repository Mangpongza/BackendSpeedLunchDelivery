import { haversineKm } from "./distanceCalculator";

export interface PlannerOrder {
    id: number;
    quantity: number;
    latitude: number;
    longitude: number;
}

export interface PlannerOptions {
    excludedSignatures?: string[];
    distance?: (lat: number, lng: number, nextLat: number, nextLng: number) => number;
    shopLat: number;
    shopLng: number;
    minRiders: number;
    maxRiders: number;
    maxStopsPerRoute: number;
    boxCapacity: number;
    speedKmh: number;
    serviceMinutes: number;
    departureMin: number;
    deadlineMin: number;
    baseFee: number;
    feePerKmPerBox: number;
    latePenalty: number;
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
    distanceKm: number;
    returnDistanceKm: number;
    durationMinutes: number;
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

export function routeSignature(routes: number[][]): string {
    return routes.map(ids => ids.join(',')).sort().join('|');
}

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

export function bestRoute<T extends PlannerOrder>(group: T[], opt: PlannerOptions): PlannedRoute<T> | null {
    const totalBoxes = group.reduce((s, o) => s + Number(o.quantity), 0);
    if (group.length === 0 || group.length > opt.maxStopsPerRoute || totalBoxes > opt.boxCapacity) return null;

    let best: PlannedRoute<T> | null = null;
    let bestScore = INFEASIBLE;

    const orders = group.length <= 6 ? permutations(group) : [nearestNeighbor(group, opt)];
    for (const seq of orders) {
        let lat = opt.shopLat, lng = opt.shopLng, dist = 0, late = 0;
        let serviceTime = 0;
        const stops: PlannedStop<T>[] = seq.map((o, i) => {
            const d = (opt.distance ?? haversineKm)(lat, lng, o.latitude, o.longitude);
            if (i > 0 && (lat !== o.latitude || lng !== o.longitude)) serviceTime += opt.serviceMinutes;
            dist += d;
            lat = o.latitude;
            lng = o.longitude;

            const arrivalMin = opt.departureMin + (dist / opt.speedKmh) * 60 + serviceTime;
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
                returnDistanceKm: (opt.distance ?? haversineKm)(lat, lng, opt.shopLat, opt.shopLng),
                durationMinutes: (dist / opt.speedKmh) * 60 + serviceTime + opt.serviceMinutes,
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
            const d = (opt.distance ?? haversineKm)(lat, lng, o.latitude, o.longitude);
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

function splitIntoRoutes<T extends PlannerOrder>(seq: T[], k: number, opt: PlannerOptions, cache: Map<string, PlannedRoute<T> | null>) {
    const n = seq.length;
    const L = opt.maxStopsPerRoute;

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
        Math.min(opt.minRiders, orders.length),
        Math.ceil(orders.length / opt.maxStopsPerRoute),
        Math.ceil(totalBoxes / opt.boxCapacity)
    );
    if (kMin > opt.maxRiders) {
        throw new PlannerError(`Not enough riders (need at least ${kMin}, have ${opt.maxRiders})`);
    }
    const kMax = Math.min(opt.maxRiders, orders.length);

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
            if (r && opt.excludedSignatures?.includes(routeSignature(r.routes.map(route => route.stops.map(stop => stop.order.id))))) continue;
            if (r && (bestAtK === null || better(r.score, bestAtK.score))) bestAtK = r;
        }

        if (bestAtK && (best === null || better(bestAtK.score, best.score))) best = bestAtK;
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
