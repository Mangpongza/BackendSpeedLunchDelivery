import express from "express";
import { getShopSettings, updateShopSettings } from "../controllers/settingsController";

export const router = express.Router();

router.get("/", getShopSettings);
router.put("/", updateShopSettings);
