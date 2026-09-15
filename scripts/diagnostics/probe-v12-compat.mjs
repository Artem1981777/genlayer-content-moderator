import { createClient } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";

const address = "0x62A9196dBB55585840D13631aB7C68288761a74A";
const client = createClient({ chain: testnetBradbury });
for (const [functionName, args] of [["get_config", []], ["get_item_ids", []], ["get_all_items", [0, 3]]]) {
  try {
    const raw = await client.readContract({ address, functionName, args });
    let value = raw;
    try { value = raw === "" ? null : JSON.parse(raw); } catch {}
    const summary = value && typeof value === "object"
      ? { keys: Object.keys(value).slice(0, 20), values: Object.fromEntries(Object.entries(value).slice(0, 8)) }
      : { value: String(value).slice(0, 300) };
    console.log(JSON.stringify({ functionName, ok: true, summary }));
  } catch (error) {
    console.log(JSON.stringify({ functionName, ok: false, error: String(error?.message || error).split("Details:")[0].slice(0, 240) }));
  }
}
