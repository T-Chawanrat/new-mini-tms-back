import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import db from "../../config/db.js";

const JWT_SECRET = process.env.JWT_SECRET || "dev_secret";
const inboxRoom = "delivery-issues:inbox";
let io;

export const deliveryIssueRoom = (issueId) => `delivery-issue:${issueId}`;
const driverInboxRoom = (driverId) => `driver-delivery-issues:${driverId}`;

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
