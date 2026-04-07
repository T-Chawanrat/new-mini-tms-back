import db from "./config/db.js";
import bcrypt from "bcrypt";

const hashPasswords = async () => {
  console.log("⏳ Start hashing passwords...\n");

  const connection = await db.getConnection();

  try {
    const [users] = await connection.query(
      "SELECT user_id, password FROM um_users"
    );

    for (let user of users) {
      const plainPass = user.password;
      const hashed = await bcrypt.hash(plainPass, 10);

      await connection.query(
        "UPDATE um_users SET password = ? WHERE user_id = ?",
        [hashed, user.user_id]
      );

      console.log(`✅ Hashed user_id ${user.user_id}`);
    }

    console.log("\n🎉 All passwords have been hashed successfully!");
  } catch (err) {
    console.error("❌ Error while hashing passwords:", err);
  } finally {
    connection.release();
    process.exit();
  }
};

hashPasswords();
