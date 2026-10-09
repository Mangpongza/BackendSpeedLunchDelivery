/** ระยะทางเส้นตรงระหว่าง 2 พิกัด (กิโลเมตร) ด้วยสูตร Haversine */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function round(n: number, digits = 2): number {
    const f = 10 ** digits;
    return Math.round(n * f) / f;
}
