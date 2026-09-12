"""Versioned rules, thresholds governance, and read views."""
import json

from conftest import (BENIGN_PAGE, BENIGN_URL, make_scores, mock_llm_pair, warp)


def test_rules_versioning(direct_vm, deploy, direct_owner):
    contract = deploy()
    direct_vm.sender = direct_owner
    v1 = json.loads(contract.get_rules(1))
    assert v1["version"] == 1
    assert "No spam" in v1["text"]
    assert v1["flag_bp"]["scam"] == 5000
    new_version = contract.set_rules("Community rules v2: zero tolerance for scams.")
    assert int(new_version) == 2
    v2 = json.loads(contract.get_rules(2))
    assert "zero tolerance" in v2["text"]
    assert contract.get_rules(99) == ""
    versions = json.loads(contract.get_rules_versions())
    assert [v["version"] for v in versions] == [1, 2]


def test_set_rules_owner_only(direct_vm, deploy, direct_owner, direct_bob):
    contract = deploy()
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("Only owner can set rules"):
        contract.set_rules("my rules")
    direct_vm.sender = direct_owner
    contract.set_rules("new rules")  # ok


def test_set_rules_rejects_empty(direct_vm, deploy, direct_owner):
    contract = deploy()
    direct_vm.sender = direct_owner
    with direct_vm.expect_revert("must not be empty"):
        contract.set_rules("   ")


def test_set_thresholds_validation(direct_vm, deploy, direct_owner, direct_bob):
    contract = deploy()
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("Only owner"):
        contract.set_thresholds("scam", 1000, 2000)
    direct_vm.sender = direct_owner
    with direct_vm.expect_revert("Unknown policy axis"):
        contract.set_thresholds("politics", 1000, 2000)
    with direct_vm.expect_revert("bps"):
        contract.set_thresholds("scam", 20000, 30000)
    with direct_vm.expect_revert("must be >= FLAG"):
        contract.set_thresholds("scam", 8000, 5000)
    contract.set_thresholds("scam", 1000, 9000)  # ok
    cfg = json.loads(contract.get_config())
    assert cfg["flag_bp"]["scam"] == 1000
    assert cfg["remove_bp"]["scam"] == 9000


def test_config_view(direct_vm, deploy, direct_owner):
    contract = deploy()
    cfg = json.loads(contract.get_config())
    for key in ("owner", "min_stake", "report_bond", "appeal_bond",
                "enforce_timeout_sec", "appeal_resolve_cooldown_sec",
                "appeal_timeout_sec", "llm_cooldown_sec",
                "max_open_reports", "max_open_appeals", "pool",
                "flag_bp", "remove_bp"):
        assert key in cfg
    assert cfg["appeal_bond"] == 2_000_000_000_000


def test_get_item_unknown_returns_empty(direct_vm, deploy):
    contract = deploy()
    assert contract.get_item("nonexistent") == ""


def test_read_content_masking_flag_limited(direct_vm, deploy, direct_owner):
    contract = deploy()
    direct_vm.mock_web(BENIGN_URL, {"status": 200, "body": BENIGN_PAGE})
    mock_llm_pair(direct_vm, make_scores(spam=60), "FLAG", confidence=80)
    direct_vm.sender = direct_owner
    item_id = contract.create_item("")
    direct_vm.value = 1_000_000_000_000
    contract.ingest(item_id, BENIGN_URL)
    direct_vm.value = 0
    contract.moderate(item_id)
    contract.enforce(item_id)
    assert contract.read_content(item_id).startswith("[limited] ")
    pub = json.loads(contract.get_item(item_id))
    assert pub["content"].startswith("[limited] ")


def test_reverify_source(direct_vm, deploy, direct_owner):
    contract = deploy()
    direct_vm.mock_web(BENIGN_URL, {"status": 200, "body": BENIGN_PAGE})
    mock_llm_pair(direct_vm, make_scores(), "APPROVE", confidence=95)
    direct_vm.sender = direct_owner
    item_id = contract.create_item("")
    direct_vm.value = 1_000_000_000_000
    contract.ingest(item_id, BENIGN_URL)
    direct_vm.value = 0
    contract.moderate(item_id)
    direct_vm.mock_llm(r"TASK: VERIFY", json.dumps({"match": "YES"}))
    warp(direct_vm, 61)  # moderate set last_llm_ts: wait out the LLM cooldown
    assert contract.reverify_source(item_id) is True
    with direct_vm.expect_revert("cooldown active"):
        contract.reverify_source(item_id)  # immediately after the LLM call
