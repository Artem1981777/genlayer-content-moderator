import { readFileSync } from "node:fs";
import { createClient, createAccount } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";
const acc = createAccount(process.env.PRIVATE_KEY);
const c = createClient({ chain: testnetBradbury, account: acc });
const A = readFileSync("registry-contract.txt", "utf8").trim();
const ids = ["23155046c3234aac", "bb3b51424b36d380", "fb0426a584f78b69", "3884daf20bdf64dc"];
for (const id of ids) {
  console.log("----", id);
  let it = null;
  try { it = JSON.parse(await c.readContract({ address: A, functionName: "get_item", args: [id] })); }
  catch (e) { console.log("  get_item ERR:", String(e?.message || e)); continue; }
  console.log("  status:", it.status, "| verdict:", it.verdict, "| content_hash:", it.content_hash);
  console.log("  source:", it.source, "| needs_review:", it.needs_review, "| escalated:", it.escalated);
  let rc = "";
  try { rc = await c.readContract({ address: A, functionName: "read_content", args: [id] }); }
  catch (e) { rc = "read_content ERR " + String(e?.message || e); }
  console.log("  content_len:", String(rc || "").length, "| head:", String(rc || "").slice(0, 160).replace(/\s+/g, " "));
}
console.log("=== DIAG DONE ===");
