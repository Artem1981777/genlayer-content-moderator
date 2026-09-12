"""Appeals: filing, permissionless consensus resolution, timeout reclaim.

Note: the item author is the account that called ingest (owner in these tests),
so the author files and owns the appeal."""
import json

import conftest
from conftest import (BENIGN_PAGE, BENIGN_URL, SCAM_PAGE, SCAM_URL,
                      make_scores, mock_llm_pair, warp)


def _enforced_removed(direct_vm, contract, owner, url=SCAM_URL, page=SCAM_PAGE):
    direct_vm.clear_mocks()
    direct_vm.mock_web(url, {"status": 200, "body": page})
    mock_llm_pair(direct_vm, make_scores(scam=95), "REMOVE", confidence=99)
    direct_vm.sender = owner
    item_id = contract.create_item("")
    direct_vm.value = 1_000_000_000_000
    contract.ingest(item_id, url)
    direct_vm.value = 0
    contract.moderate(item_id)
    contract.enforce(item_id)
    return item_id


def test_appeal_only_author_with_bond(direct_vm, deploy, direct_owner, direct_bob):
    contract = deploy()
    item_id = _enforced_removed(direct_vm, contract, direct_owner)
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("Only the author can appeal"):
        direct_vm.value = 2_000_000_000_000
        contract.appeal(item_id, "this is not a scam")
        direct_vm.value = 0
    direct_vm.sender = direct_owner  # the ingester is the author
    with direct_vm.expect_revert("Appeal stake below minimum"):
        direct_vm.value = 1_999_999_999_999
        contract.appeal(item_id, "this is not a scam")
        direct_vm.value = 0
    direct_vm.value = 2_000_000_000_000
    contract.appeal(item_id, "this is not a scam")
    direct_vm.value = 0
    item = json.loads(contract.get_item(item_id))
    assert item["status"] == "appealed"
    assert item["appeal_stake"] == 2_000_000_000_000
    assert item["appeal_note"] == "this is not a scam"


def test_appeal_requires_enforced(direct_vm, deploy, direct_owner, direct_alice):
    contract = deploy()
    direct_vm.mock_web(BENIGN_URL, {"status": 200, "body": BENIGN_PAGE})
    mock_llm_pair(direct_vm, make_scores(), "APPROVE", confidence=95)
    direct_vm.sender = direct_owner
    item_id = contract.create_item("")
    direct_vm.value = 1_000_000_000_000
    contract.ingest(item_id, BENIGN_URL)
    direct_vm.value = 0
    direct_vm.value = 2_000_000_000_000
    with direct_vm.expect_revert("Only enforced items"):
        contract.appeal(item_id, "note")
    direct_vm.value = 0


def test_appeal_note_validated(direct_vm, deploy, direct_owner):
    contract = deploy()
    item_id = _enforced_removed(direct_vm, contract, direct_owner)
    direct_vm.value = 2_000_000_000_000
    with direct_vm.expect_revert("Appeal note must not be empty"):
        contract.appeal(item_id, "   ")
    with direct_vm.expect_revert("Appeal note exceeds"):
        contract.appeal(item_id, "x" * 1001)
    direct_vm.value = 0


def test_resolve_permissionless_overturned(direct_vm, deploy, direct_owner, direct_bob):
    contract = deploy(appeal_resolve_cooldown_sec=60)
    item_id = _enforced_removed(direct_vm, contract, direct_owner)
    direct_vm.sender = direct_owner  # author files the appeal
    direct_vm.value = 2_000_000_000_000
    contract.appeal(item_id, "this is clearly not a scam")
    direct_vm.value = 0
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("cooldown has not elapsed"):
        contract.resolve_appeal(item_id)
    warp(direct_vm, 61)
    direct_vm.clear_mocks()
    direct_vm.mock_web(SCAM_URL, {"status": 200, "body": SCAM_PAGE})
    direct_vm.mock_llm(r"TASK: EXTRACT", conftest.extract_reply("Some post text."))
    direct_vm.mock_llm(r"TASK: DECIDE", conftest.decide_reply(
        make_scores(), "APPROVE", confidence=92, rationale="actually clean"))
    contract.resolve_appeal(item_id)  # permissionless: anyone may trigger
    item = json.loads(contract.get_item(item_id))
    assert item["status"] == "resolved"
    assert item["appeal_outcome"] == "overturned"
    assert item["verdict"] == "APPROVE"
    assert item["blocked"] is False
    payouts = json.loads(contract.get_payouts(0, 50))["payouts"]
    refund = [p for p in payouts if p["reason"] == "appeal_overturned_refund"]
    assert refund and refund[0]["amount"] == 3_000_000_000_000  # bond + restored forfeit
    rep = json.loads(contract.get_reputation(item["author"]))
    assert rep["appeals_won"] == 1


def test_resolve_upheld(direct_vm, deploy, direct_owner):
    contract = deploy(appeal_resolve_cooldown_sec=60)
    item_id = _enforced_removed(direct_vm, contract, direct_owner)
    direct_vm.sender = direct_owner
    direct_vm.value = 2_000_000_000_000
    contract.appeal(item_id, "i disagree")
    direct_vm.value = 0
    warp(direct_vm, 61)
    direct_vm.clear_mocks()
    direct_vm.mock_web(SCAM_URL, {"status": 200, "body": SCAM_PAGE})
    direct_vm.mock_llm(r"TASK: EXTRACT", conftest.extract_reply("Some post text."))
    direct_vm.mock_llm(r"TASK: DECIDE", conftest.decide_reply(
        make_scores(scam=97), "REMOVE", confidence=99, rationale="still a scam"))
    contract.resolve_appeal(item_id)
    item = json.loads(contract.get_item(item_id))
    assert item["status"] == "enforced"
    assert item["appeal_outcome"] == "upheld"
    stats = json.loads(contract.get_stats())
    assert stats["pool"] == 3_000_000_000_000  # forfeit 1e12 + appeal stake 2e12


def test_resolve_lighter_verdict_counts_as_overturn(direct_vm, deploy, direct_owner):
    contract = deploy(appeal_resolve_cooldown_sec=60)
    item_id = _enforced_removed(direct_vm, contract, direct_owner)
    direct_vm.sender = direct_owner
    direct_vm.value = 2_000_000_000_000
    contract.appeal(item_id, "too harsh")
    direct_vm.value = 0
    warp(direct_vm, 61)
    direct_vm.clear_mocks()
    direct_vm.mock_web(SCAM_URL, {"status": 200, "body": SCAM_PAGE})
    direct_vm.mock_llm(r"TASK: EXTRACT", conftest.extract_reply("Some post text."))
    direct_vm.mock_llm(r"TASK: DECIDE", conftest.decide_reply(
        make_scores(scam=60), "FLAG", confidence=80, rationale="borderline"))
    contract.resolve_appeal(item_id)
    item = json.loads(contract.get_item(item_id))
    assert item["appeal_outcome"] == "overturned"
    assert item["verdict"] == "FLAG"
    assert item["limited"] is True and item["blocked"] is False


def test_reclaim_after_timeout(direct_vm, deploy, direct_owner, direct_bob):
    contract = deploy(appeal_timeout_sec=7200)
    item_id = _enforced_removed(direct_vm, contract, direct_owner)
    direct_vm.sender = direct_owner
    direct_vm.value = 2_000_000_000_000
    contract.appeal(item_id, "please review")
    direct_vm.value = 0
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("timeout has not elapsed"):
        contract.reclaim_appeal(item_id)
    warp(direct_vm, 7201)
    contract.reclaim_appeal(item_id)  # permissionless liveness
    item = json.loads(contract.get_item(item_id))
    assert item["appeal_outcome"] == "reclaimed_timeout"
    payouts = json.loads(contract.get_payouts(0, 50))["payouts"]
    back = [p for p in payouts if p["reason"] == "appeal_stake_reclaimed"]
    assert back and back[0]["amount"] == 2_000_000_000_000
