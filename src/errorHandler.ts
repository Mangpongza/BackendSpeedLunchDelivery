import { NextFunction, Request, Response } from "express";

/** โยน error พร้อม HTTP status แล้วให้ errorHandler ตอบกลับเป็น JSON */
export class HttpError extends Error {
    constructor(public status: number, message: string, public details?: unknown) {
        super(message);
    }
}

export const notFoundHandler = (req: Request, res: Response) => {
    res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
};

// Express 5 ส่ง error จาก async handler มาที่นี่อัตโนมัติ
export const errorHandler = (err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
        const body: Record<string, unknown> = { error: err.message };
        if (err.details !== undefined) body.details = err.details;
        return res.status(err.status).json(body);
    }
    if (err?.type === "entity.parse.failed") {
        return res.status(400).json({ error: "Invalid JSON body" });
    }
    if (err?.code === "ER_DUP_ENTRY") {
        return res.status(409).json({ error: "Duplicate value", details: err.sqlMessage });
    }
    if (err?.code === "ER_ROW_IS_REFERENCED_2") {
        return res.status(409).json({ error: "Record is in use by other data", details: err.sqlMessage });
    }
    if (err?.code === "ER_CHECK_CONSTRAINT_VIOLATED" || err?.code === "ER_CONSTRAINT_FAILED") {
        return res.status(400).json({ error: "Value violates database rule", details: err.sqlMessage });
    }
    console.error(err);
    return res.status(500).json({ error: "Database error", details: err?.message ?? String(err) });
};
