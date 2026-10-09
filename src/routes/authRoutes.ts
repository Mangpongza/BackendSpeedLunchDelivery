import express from "express";
import { riderLogin } from "../controllers/authController";
import { requireRider } from "../middleware/auth";
import { deliverMyStop, getMe, getMyJobByCode, getMyJobs, startMyJob } from "../controllers/riderJobController";

// /api/auth
export const authRouter = express.Router();
authRouter.post("/rider-login", riderLogin);

// /api/me  (หน้าจอไรเดอร์ ต้องแนบ Authorization: Bearer <token>)
export const meRouter = express.Router();
meRouter.use(requireRider);
meRouter.get("/", getMe);
meRouter.get("/jobs", getMyJobs);
meRouter.get("/jobs/:code", getMyJobByCode);
meRouter.patch("/jobs/:code/start", startMyJob);
meRouter.patch("/jobs/:code/stops/:sequence/deliver", deliverMyStop);
