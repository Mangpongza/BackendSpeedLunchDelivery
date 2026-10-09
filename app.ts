import express from "express";
import cors from "cors";
import { router as customerRoutes } from "./src/routes/customerRoutes";
import { router as orderRoutes } from "./src/routes/orderRoutes";
import { router as planningRoutes } from "./src/routes/planningRoutes";
import { router as jobRoutes } from "./src/routes/jobRoutes";
import { router as riderRoutes } from "./src/routes/riderRoutes";
import { router as settingsRoutes } from "./src/routes/settingsRoutes";
import { authRouter, meRouter } from "./src/routes/authRoutes";
import { errorHandler, notFoundHandler } from "./src/errorHandler";

export const app = express();

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
});

// ---- หน้าจอเจ้าของร้าน ----
app.use("/api/settings", settingsRoutes);
app.use("/api/customer", customerRoutes);
app.use("/api/order", orderRoutes);
app.use("/api/riders", riderRoutes);
app.use("/api/route", planningRoutes);
app.use("/api/jobs", jobRoutes);

// ---- หน้าจอไรเดอร์ ----
app.use("/api/auth", authRouter);
app.use("/api/me", meRouter);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
