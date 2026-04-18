import db from "../config/db.js";
import bcrypt from "bcrypt";

const run = async () => {
  const [users] = await db.query("SELECT id, password FROM um_users");

  for (const user of users) {
    // ข้ามถ้า hash แล้ว (กันรันซ้ำ)
    if (user.password.startsWith("$2b$")) continue;

    const hashed = await bcrypt.hash(user.password, 10);

    await db.query(
      "UPDATE um_users SET password = ? WHERE id = ?",
      [hashed, user.id]
    );

    console.log(`User ${user.id} updated`);
  }

  console.log("DONE");
  process.exit();
};

run();