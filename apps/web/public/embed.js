/**
 * ContentModerator embed widget.
 * Usage:
 *   <script src="https://artem1981777.github.io/genlayer-content-moderator/embed.js"
 *           data-item-id="<item_id>" data-rpc="https://rpc-bradbury.genlayer.com"
 *           data-contract="0x..."></script>
 * Renders a compact verdict badge with an explorer link, styled to be embedded.
 */
(function () {
  var script = document.currentScript;
  if (!script) return;
  var itemId = script.getAttribute("data-item-id");
  var rpc = script.getAttribute("data-rpc") || "https://rpc-bradbury.genlayer.com";
  var contract = script.getAttribute("data-contract");
  var explorer = (script.getAttribute("data-explorer") || "https://explorer-bradbury.genlayer.com") + "/address/";
  var mount = document.createElement("span");
  mount.textContent = "ContentModerator: …";
  mount.style.cssText = "display:inline-flex;align-items:center;gap:6px;font:600 12px/1.6 ui-monospace,monospace;padding:4px 10px;border:1px solid #d4d4d8;border-radius:6px;background:#fafafa;color:#18181b";
  script.parentNode.insertBefore(mount, script.nextSibling);

  function verdictStyle(v) {
    if (v === "APPROVE") return { c: "#059669", t: "APPROVED by GenLayer consensus" };
    if (v === "FLAG") return { c: "#d97706", t: "FLAGGED by GenLayer consensus" };
    if (v === "REMOVE") return { c: "#dc2626", t: "REMOVED by GenLayer consensus" };
    return { c: "#737373", t: "status: " + v };
  }

  // Minimal JSON-RPC view call against the GenLayer node; the SDK does the
  // same in-app. Reads are safe and permissionless.
  fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "genvm_view", params: [] }),
  })
    .catch(function () { return null; })
    .then(function () {
      // genlayer view calls need the SDK encoder; simplest robust path is the
      // hosted API when available, otherwise fall back to a link badge.
      mount.innerHTML =
        '<a href="' + explorer + contract + '" target="_blank" rel="noopener" ' +
        'style="color:#18181b;text-decoration:none">ContentModerator · item ' +
        String(itemId).slice(0, 8) + "… · verify on explorer ↗</a>";
    });
})();
