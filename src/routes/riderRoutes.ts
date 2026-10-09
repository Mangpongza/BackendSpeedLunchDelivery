import express from "express";
import { createRider, deleteRiderByID, getRiderByID, getRiders, updateRiderByID } from "../controllers/riderController";

export const router = express.Router();

router.get("/", getRiders);
router.get("/:id", getRiderByID);
router.post("/", createRider);
router.put("/:id", updateRiderByID);
router.delete("/:id", deleteRiderByID);
