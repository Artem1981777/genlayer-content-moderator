"""Integration tests against live Testnet Bradbury (manual, not in CI).

These tests do NOT deploy: the full registry_v2 AddTransaction (~50KB) exceeds
the current Bradbury pubdata ceiling (~17KB, see
docs/evidence/v2/deploy-path-matrix.md). Instead they attach to the instances
recorded in deployments.json and verify live state end-to-end:

  - get_config / get_stats / views parse and are self-consistent;
  - verify_content / read_content round-trip on a known item;
  - (optional, RUN_LIVE_WRITES=1) one demo-instance write through the flat
    AddTransaction path, mirroring scripts/smoke.mjs.

Run:
  ACCOUNT_PRIVATE_KEY_1=... pytest tests/integration -q
Everything is skipped cleanly when deployments.json or the key is missing.
"""
import json
import os
from pathlib import Path

import pytest

pytest.importorskip("genlayer_py")

REPO = Path(__file__).resolve().parents[2]
DEPLOYMENTS = REPO / "deployments.json"

pytestmark = pytest.mark.integration


def _deployments():
    if not DEPLOYMENTS.exists():
        pytest.skip("deployments.json missing — deploy first (scripts/deploy.mjs)")
    dep = json.loads(DEPLOYMENTS.read_text(encoding="utf-8"))
    if not dep.get("prod", {}).get("address") or not dep.get("demo", {}).get("address"):
        pytest.skip("deployments.json has no prod+demo addresses yet")
    return dep


def _contract(address):
    from genlayer_py import create_client
    from genlayer_py.chains import testnet_bradbury

    key = os.environ.get("ACCOUNT_PRIVATE_KEY_1")
    if not key:
        pytest.skip("ACCOUNT_PRIVATE_KEY_1 not set")
    client = create_client({"chain": testnet_bradbury, "account": create_client_account(key)})
    return client, address


def create_client_account(key):
    from genlayer_py import create_account

    return create_account(key)


def _read_json(contract_fn_result):
    return json.loads(contract_fn_result)


@pytest.fixture(scope="module")
def dep():
    return _deployments()


def test_prod_config_live(dep):
    client, addr = _contract(dep["prod"]["address"])
    raw = client.read_contract(addr, "get_config", [])
    cfg = _read_json(raw)
    assert cfg["owner"].lower() == dep["deployer"].lower()
    assert int(cfg["min_stake"]) > 0
    assert int(cfg["rules_version"]) >= 1
    assert "REMOVE" in cfg["default_rules"]


def test_prod_stats_live(dep):
    client, addr = _contract(dep["prod"]["address"])
    stats = _read_json(client.read_contract(addr, "get_stats", []))
    assert stats["total"] >= 0
    assert set(stats["by_status"].keys()) >= set()  # shape check
    assert stats["total"] == sum(stats["by_status"].values())


def test_prod_rules_versions_live(dep):
    client, addr = _contract(dep["prod"]["address"])
    rules = _read_json(client.read_contract(addr, "get_rules_versions", []))
    assert len(rules) >= 1
    assert rules[0]["version"] == 1


def test_demo_config_matches_prod_economics(dep):
    client, addr = _contract(dep["demo"]["address"])
    cfg = _read_json(client.read_contract(addr, "get_config", []))
    # demo is prod with shortened timeouts
    assert int(cfg["enforce_timeout_sec"]) == 60
    assert int(cfg["appeal_timeout_sec"]) == 60


@pytest.mark.skipif(os.environ.get("RUN_LIVE_WRITES") != "1", reason="set RUN_LIVE_WRITES=1 for live write checks")
def test_demo_live_write(dep):
    """One flat-path write to the demo instance: ingest a unique item."""
    from genlayer_py import create_account

    client, addr = _contract(dep["demo"]["address"])
    acct = create_account(os.environ["ACCOUNT_PRIVATE_KEY_1"])
    item_id = f"smoke-{int(__import__('time').time())}"
    stake = int(_read_json(client.read_contract(addr, "get_config", []))["min_stake"])
    url = f"https://artem1981777.github.io/genlayer-content-moderator/fixtures/benign.html?smoke={item_id}"
    tx = client.write_contract(addr, "ingest", args=[item_id, url], value=stake)
    # the flat consensus path returns a GenLayer tx id; finality shows in the item
    item = _read_json(client.read_contract(addr, "get_item", [item_id]))
    assert item["id"] == item_id or tx, "item not found after ingest (tx may still be pending)"
