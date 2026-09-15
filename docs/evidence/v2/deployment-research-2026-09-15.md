# Deployment research — 2026-09-15

## Verified official guidance

- GenLayer docs list CLI direct deployment and JavaScript/TypeScript deploy scripts as supported methods.
- Official deploy scripts guidance recommends `deployContract`, waiting for finalization, checking `isSuccessful`, and recording transaction IDs/address before resuming; it also says not to re-broadcast blindly after submission.
- GenLayer Studio is a local/interactive sandbox path: load the Python contract, set constructor parameters, and click Deploy. The simulator README requires Docker 26+ and Node 18+.
- The docs homepage exposes deployment sections, network configuration, CLI deployment, deploy scripts, and Studio deployment.

## Project-specific evidence

- GitHub Actions run `34964258284` passed preflight and failed in `scripts/deploy.mjs` during `eth_estimateGas` / `eth_sendRawTransaction`.
- The deploy log reports `AddTransaction V5: calldata 50276 bytes` and RPC `Internal error` (`-32603`).
- The failure happened before a confirmed GenLayer transaction ID or contract address was recorded. No deployment should be assumed.
- Project code intentionally uses a flat AddTransaction encoder because the current pinned `genlayer-js` release had a struct-variant incompatibility according to the repository history.
- The repository already contains a payload-size probe and documents the Bradbury pubdata ceiling as a known blocker.

## Next safe path

1. Do not retry the 50 KB broadcast blindly.
2. Run a non-broadcast size probe or use Studio/local simulator to validate the contract.
3. Compare the official current CLI/SDK versions and fee/deploy profile against the pinned `genlayer-js` 2.0.0-rc.1 path.
4. Only attempt live deployment after confirming an accepted encoding/size path and preserving tx IDs in deploy state.

## Sources

- https://docs.genlayer.com/developers/intelligent-contracts/deploying/deployment-methods
- https://docs.genlayer.com/developers/intelligent-contracts/deploying/cli-deployment
- https://docs.genlayer.com/developers/intelligent-contracts/deploying/deploy-scripts
- https://docs.genlayer.com/developers/intelligent-contracts/tools/genlayer-studio/deploying-contract
- https://github.com/yeagerai/genlayer-simulator
- https://studio.genlayer.com/contracts
- https://github.com/Artem1981777/genlayer-content-moderator/actions/runs/34964258284

This note contains no private keys or secrets.
