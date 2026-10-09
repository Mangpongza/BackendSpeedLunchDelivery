import express from "express";
import {
    createCustomer,
    deleteCustomerByID,
    getCustomerByPhone,
    getCustomerOrders,
    getCustomers,
    getCustomersByID,
    getNearbyCustomers,
    searchCustomers,
    updateCustomerByID,
} from "../controllers/customerController";

export const router = express.Router();

// path คงที่ต้องมาก่อน /:id
router.get("/", getCustomers);
router.get("/nearby", getNearbyCustomers);
router.get("/search/fields", searchCustomers);
router.get("/phone/:phone", getCustomerByPhone);
router.get("/:id", getCustomersByID);
router.get("/:id/orders", getCustomerOrders);
router.post("/", createCustomer);
router.put("/:id", updateCustomerByID);
router.delete("/:id", deleteCustomerByID);
