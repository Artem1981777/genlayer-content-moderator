"""Smoke tests: deploy, init validation, config view. Also validates that the
typed storage layout (storage dataclasses, TreeMap values, DynArray fields)
works end-to-end in the direct VM."""
import json

from gltest.direct.loader import create_address

PARAM_NAMES = ["default_rules", "min_stake", "report_bond", "appeal_bond",
               "enforce_timeout_sec", "appeal_resolve_cooldown_sec",
               "appeal_timeout_sec", "llm_cooldown_sec",
               "max_open_reports", "max_open_appeals"]


def test_deploy_and_config(deploy, direct_vm):
    contract = deploy()
    cfg = json.loads(contract.get_config())
    assert cfg["min_stake"] == 1_000_000_000_000
    assert cfg["item_count"] == 0
    assert cfg["rules_version"] == 1
    assert cfg["owner"]


def test_init_rejects_zero_stake(deploy, direct_vm):
    with direct_vm.expect_revert("Economic constants must be positive"):
        deploy(min_stake=0)


def test_init_rejects_zero_timeout(deploy, direct_vm):
    with direct_vm.expect_revert("Timeouts must be positive"):
        deploy(enforce_timeout_sec=0)


def test_init_rejects_zero_caps(deploy, direct_vm):
    with direct_vm.expect_revert("Open-item caps must be positive"):
        deploy(max_open_reports=0)


def test_default_rules_fallback(direct_vm, direct_deploy):
    contract = direct_deploy("contracts/registry_v2.py", "", 1, 1, 1, 1, 1, 1, 1, 1, 1,
                             sdk_version="v0.2.16")
    cfg = json.loads(contract.get_config())
    assert "No spam" in cfg["default_rules"]
