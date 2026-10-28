import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import db from "../../config/db.js";

const JWT_SECRET = process.env.JWT_SECRET || "dev_secret";
const inboxRoom = "delivery-issues:inbox";
let io;

export const deliveryIssueRoom = (issueId) => `delivery-issue:${issueId}`;
const driverInboxRoom = (driverId) => `driver-delivery-issues:${driverId}`;
const warehouseScanRoom = (type, warehouseId) => `${type}:warehouse:${warehouseId}`;
const truckScanRoom = (type, truckLoadId) => `${type}:truck:${truckLoadId}`;

const joinWarehouseScanRoom = (socket, event, type) => {
  socket.on(event, (callback) => {
    const warehouseId = Number(socket.data.user.warehouse_id);
    if (!Number.isInteger(warehouseId) || warehouseId <= 0) {
      callback?.({ success: false });
      return;
    }
    socket.join(warehouseScanRoom(type, warehouseId));
    callback?.({ success: true });
  });
};

const joinTruckScanRoom = (socket, event, type, truckStatus) => {
  socket.on(event, async (truckLoadId, callback) => {
    try {
      const id = Number(truckLoadId);
      const warehouseId = Number(socket.data.user.warehouse_id);
      const userId = Number(socket.data.user.id);
      if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(userId) || userId <= 0) {
        callback?.({ success: false });
        return;
      }
      const [rows] = await db.query(
        `SELECT 1 FROM tm_trucks
         WHERE id = ? AND status = ? AND COALESCE(is_deleted, 'N') = 'N'
           AND (warehouse_id = ? OR user_truck_id = ?)
         LIMIT 1`,
        [id, truckStatus, Number.isInteger(warehouseId) ? warehouseId : null, userId],
      );
      if (!rows.length) {
        callback?.({ success: false });
        return;
      }
      socket.join(truckScanRoom(type, id));
      callback?.({ success: true });
    } catch {
      callback?.({ success: false });
    }
  });
};

export const initializeSocketServer = (httpServer) => {
  io = new Server(httpServer, {
    cors: {
      origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",").map((origin) => origin.trim()) : true,
    },
  });

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      const user = jwt.verify(token, JWT_SECRET);
      if (user.purpose !== "ACCESS" || !Number.isInteger(Number(user.id)) || Number(user.id) <= 0) {
        return next(new Error("unauthorized"));
      }
      socket.data.user = user;
      return next();
    } catch {
      return next(new Error("unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    joinWarehouseScanRoom(socket, "dc-receive:join", "dc-receive");
    joinWarehouseScanRoom(socket, "warehouse-receive:join", "warehouse-receive");
    joinTruckScanRoom(socket, "truckload-scan:join", "truckload-scan", "DC_TRUCK_DC");
    joinTruckScanRoom(socket, "delivery-truck-scan:join", "delivery-truck-scan", "DC_TRUCK");

    socket.on("delivery-issues:inbox:join", (callback) => {
      if (Number(socket.data.user.role_id) === 7) {
        callback?.({ success: false });
        return;
      }
      socket.join(inboxRoom);
      callback?.({ success: true });
    });
    socket.on("driver-delivery-issues:inbox:join", (callback) => {
      socket.join(driverInboxRoom(socket.data.user.id));
      callback?.({ success: true });
    });
    socket.on("delivery-issue:join", async (issueId, callback) => {
      try {
        const id = Number(issueId);
        if (!Number.isInteger(id) || id <= 0) {
          callback?.({ success: false });
          return;
        }
        if (Number(socket.data.user.role_id) === 7) {
          const [rows] = await db.query(
          `SELECT 1
           FROM tm_delivery_issues issue
           INNER JOIN tm_receive_serials receive_serial
             ON receive_serial.receive_business_id <=> issue.receive_business_id
            AND receive_serial.receive_walkin_id <=> issue.receive_walkin_id
           INNER JOIN tm_product_trucks product
             ON product.serial_id = receive_serial.serial_id AND product.serial_no = receive_serial.serial_no
           INNER JOIN tm_trucks truck ON truck.id = product.truck_load_id
           WHERE issue.delivery_issue_id = ? AND truck.user_truck_id = ?
           LIMIT 1`,
            [id, socket.data.user.id],
          );
          if (!rows.length) {
            callback?.({ success: false });
            return;
          }
        }
        socket.join(deliveryIssueRoom(id));
        callback?.({ success: true });
      } catch {
        callback?.({ success: false });
      }
    });

    socket.on("delivery-issue:leave", (issueId) => {
      const id = Number(issueId);
      if (Number.isInteger(id) && id > 0) socket.leave(deliveryIssueRoom(id));
    });
  });

  return io;
};

export const emitDeliveryIssue = (issueId, event, payload) => {
  if (!io || !Number.isInteger(Number(issueId))) return;
  io.to(deliveryIssueRoom(issueId)).emit(event, payload);
};

export const emitDeliveryIssueInbox = (payload) => {
  io?.to(inboxRoom).emit("delivery-issue:inbox", payload);
};

export const emitDriverDeliveryIssueInbox = async (issueId, payload) => {
  if (!io || !Number.isInteger(Number(issueId))) return;
  try {
    const [rows] = await db.query(
      `SELECT DISTINCT truck.user_truck_id
       FROM tm_delivery_issues issue
       INNER JOIN tm_receive_serials receive_serial
         ON receive_serial.receive_business_id <=> issue.receive_business_id
        AND receive_serial.receive_walkin_id <=> issue.receive_walkin_id
       INNER JOIN tm_product_trucks product
         ON product.serial_id = receive_serial.serial_id AND product.serial_no = receive_serial.serial_no
       INNER JOIN tm_trucks truck ON truck.id = product.truck_load_id
       WHERE issue.delivery_issue_id = ? AND truck.user_truck_id IS NOT NULL`,
      [issueId],
    );
    rows.forEach((row) => io.to(driverInboxRoom(row.user_truck_id)).emit("driver-delivery-issue:inbox", payload));
  } catch (error) {
    console.error("emitDriverDeliveryIssueInbox error:", error);
  }
};

const emitWarehouseScanUpdate = (type, event, warehouseId, actorId) => {
  if (!io || !Number.isInteger(Number(warehouseId))) return;
  io.to(warehouseScanRoom(type, warehouseId)).emit(event, { actorId });
};

const emitTruckScanUpdate = (type, event, truckLoadId, actorId) => {
  if (!io || !Number.isInteger(Number(truckLoadId))) return;
  io.to(truckScanRoom(type, truckLoadId)).emit(event, { actorId });
};

export const emitDcReceiveUpdated = (warehouseId, actorId) =>
  emitWarehouseScanUpdate("dc-receive", "dc-receive:updated", warehouseId, actorId);

export const emitWarehouseReceiveUpdated = (warehouseId, actorId) =>
  emitWarehouseScanUpdate("warehouse-receive", "warehouse-receive:updated", warehouseId, actorId);

export const emitTruckloadScanUpdated = (truckLoadId, actorId) =>
  emitTruckScanUpdate("truckload-scan", "truckload-scan:updated", truckLoadId, actorId);

export const emitDeliveryTruckScanUpdated = (truckLoadId, actorId) =>
  emitTruckScanUpdate("delivery-truck-scan", "delivery-truck-scan:updated", truckLoadId, actorId);
