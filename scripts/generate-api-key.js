import crypto from "crypto";
console.log(`corr_${crypto.randomBytes(32).toString("base64url")}`);
