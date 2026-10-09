import express from "express";
import {
  calculatePlan,
  cancelPlan,
  getLatestPlan,
  getPendingOrders,
  getPlanById,
  getPlans,
  getShop,
} from "../controllers/routePlanningController";
import { getRiders } from "../controllers/riderController";

export const router = express.Router();

// ต้องวาง path คงที่ก่อน /:id เพื่อกันชนกัน
router.post("/calculate", calculatePlan);
router.get("/plans", getPlans);
router.get("/plans/latest", getLatestPlan);
router.get("/plans/:id", getPlanById);
router.delete("/plans/:id", cancelPlan);
router.get("/pending", getPendingOrders);
router.get("/riders", getRiders); // เส้นเดิม = GET /api/riders
router.get("/shop", getShop);     // เส้นเดิม = GET /api/settings
