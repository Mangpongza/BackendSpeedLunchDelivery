import express from "express";
import { riderLogin } from "../controllers/authController";
import { requireRider } from "../riderAuth";
import { deliverMyStop, getMe, getMyJobByCode, getMyJobs, startMyJob } from "../controllers/riderJobController";

export const authRouter = express.Router();
authRouter.post("/rider-login", riderLogin);

export const meRouter = express.Router();
meRouter.use(requireRider);
meRouter.get("/", getMe);
meRouter.get("/jobs", getMyJobs);
meRouter.get("/jobs/:code", getMyJobByCode);
meRouter.patch("/jobs/:code/start", startMyJob);
meRouter.patch("/jobs/:code/stops/:sequence/deliver", deliverMyStop);
