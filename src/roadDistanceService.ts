import { HttpError } from './errorHandler';

export interface RoadPoint { latitude: number; longitude: number; }
export type DistanceLookup = (lat: number, lng: number, nextLat: number, nextLng: number) => number;

export async function roadDistances(points: RoadPoint[], fetcher: typeof fetch = fetch): Promise<DistanceLookup> {
    const key = (lat: number, lng: number) => `${lng},${lat}`;
    const unique = [...new Map(points.map(p => [key(p.latitude, p.longitude), p])).values()];
    if (unique.some(p => !Number.isFinite(p.latitude) || !Number.isFinite(p.longitude) || Math.abs(p.latitude)>90 || Math.abs(p.longitude)>180)) {
        throw new HttpError(400, 'Invalid delivery coordinates');
    }
    if (unique.length === 1) return () => 0;
    if (unique.length < 1 || unique.length > 100) throw new HttpError(400, 'Road routing supports up to 99 different delivery locations');
    const base = (process.env.OSRM_URL ?? 'https://router.project-osrm.org').replace(/\/$/, '');
    const coordinates = unique.map(p => key(p.latitude, p.longitude)).join(';');
    let matrix: number[][];
    try {
        const response = await fetcher(`${base}/table/v1/driving/${coordinates}?annotations=distance`, { signal: AbortSignal.timeout(12000) });
        if (!response.ok) throw new Error('Road service unavailable');
        const data = await response.json() as { code: string; distances: unknown[][] };
        if (data.code !== 'Ok' || !Array.isArray(data.distances) || data.distances.length !== unique.length || data.distances.some(row => !Array.isArray(row) || row.length !== unique.length || row.some(v => typeof v !== 'number' || !Number.isFinite(v) || v < 0))) throw new Error('No road between delivery locations');
        matrix = data.distances as number[][];
    } catch {
        throw new HttpError(503, 'Cannot calculate road distances. Please retry; no plan was saved.');
    }
    const indexes = new Map(unique.map((p, i) => [key(p.latitude,p.longitude), i]));
    return (lat,lng,nextLat,nextLng) => {
        const a = indexes.get(key(lat,lng)), b = indexes.get(key(nextLat,nextLng));
        if (a === undefined || b === undefined) throw new Error('Coordinate missing from road matrix');
        return matrix[a]![b]! / 1000;
    };
}
