"""Stake settlement branches, pool conservation, payout ledger."""
import json

import conftest
from conftest import (BENIGN_PAGE, BENIGN_URL, SCAM_PAGE, SCAM_URL,
                      make_scores, mock_llm_pair, full_item, warp)


def _payouts(contract):
    return json.loads(contract.get_payouts(0, 50))["payouts"]


def _sum_paid(payouts):
    return sum(p["amount"] for p in payouts)


def test_approve_full_refund(direct_vm, deploy, direct_owner):
    contract = deploy()
    item_id = full_item(direct_vm, contract, direct_owner, BENIGN_URL, BENIGN_PAGE,
                        make_scores(), "APPROVE")
    item = json.loads(contract.get_item(item_id))
    assert item["stake_outcome"] == "author_refund"
    ps = _payouts(contract)
    assert any(p["reason"] == "author_refund" and p["amount"] == 1_000_000_000_000 for p in ps)
    assert int(json.loads(contract.get_stats())["pool"]) == 0


def test_remove_full_forfeit_to_pool(direct_vm, deploy, direct_owner):
    contract = deploy()
    item_id = full_item(direct_vm, contract, direct_owner, SCAM_URL, SCAM_PAGE,
                        make_scores(scam=95), "REMOVE")
    item = json.loads(contract.get_item(item_id))
    assert item["stake_outcome"] == "author_forfeit"
    assert item["forfeited"] == 1_000_000_000_000
    stats = json.loads(contract.get_stats())
    assert stats["pool"] == 1_000_000_000_000
    assert _sum_paid(_payouts(contract)) == 0  # nothing paid out


def test_flag_partial_forfeit(direct_vm, deploy, direct_owner):
    contract = deploy()
    item_id = full_item(direct_vm, contract, direct_owner, BENIGN_URL, BENIGN_PAGE,
                        make_scores(spam=60), "FLAG")
    item = json.loads(contract.get_item(item_id))
    assert item["stake_outcome"] == "author_partial_forfeit"
    assert item["forfeited"] == 500_000_000_000
    assert item["limited"] is True and item["blocked"] is False
    ps = _payouts(contract)
    refund = [p for p in ps if p["reason"] == "author_partial_refund"]
    assert refund and refund[0]["amount"] == 500_000_000_000
    assert int(json.loads(contract.get_stats())["pool"]) == 500_000_000_000


def test_honest_reporter_reward(direct_vm, deploy, direct_owner, direct_bob):
    contract = deploy()
    direct_vm.mock_web(SCAM_URL, {"status": 200, "body": SCAM_PAGE})
    mock_llm_pair(direct_vm, make_scores(scam=95), "APPROVE", confidence=80)
    direct_vm.sender = direct_owner
    item_id = contract.create_item("")
    direct_vm.value = 1_000_000_000_000
    contract.ingest(item_id, SCAM_URL)
    direct_vm.value = 0
    direct_vm.sender = direct_bob
    direct_vm.value = 1_000_000_000_000
    contract.report(item_id)
    direct_vm.value = 0
    direct_vm.mock_llm(r"TASK: DECIDE", conftest.decide_reply(make_scores(scam=95), "REMOVE", confidence=99))
    direct_vm.sender = direct_owner
    contract.moderate(item_id)
    contract.enforce(item_id)
    item = json.loads(contract.get_item(item_id))
    assert item["stake_outcome"] == "author_forfeit+reporter_reward"
    ps = _payouts(contract)
    reward = [p for p in ps if p["reason"] == "reporter_reward"]
    assert reward and reward[0]["amount"] == 1_500_000_000_000  # bond + forfeit//2
    stats = json.loads(contract.get_stats())
    assert stats["pool"] == 500_000_000_000  # forfeit minus bonus


def test_false_reporter_slashed(direct_vm, deploy, direct_owner, direct_bob):
    contract = deploy()
    direct_vm.mock_web(BENIGN_URL, {"status": 200, "body": BENIGN_PAGE})
    mock_llm_pair(direct_vm, make_scores(), "APPROVE", confidence=95)
    direct_vm.sender = direct_owner
    item_id = contract.create_item("")
    direct_vm.value = 1_000_000_000_000
    contract.ingest(item_id, BENIGN_URL)
    direct_vm.value = 0
    direct_vm.sender = direct_bob
    direct_vm.value = 1_000_000_000_000
    contract.report(item_id)
    direct_vm.value = 0
    direct_vm.sender = direct_owner
    contract.moderate(item_id)
    contract.enforce(item_id)
    item = json.loads(contract.get_item(item_id))
    assert item["stake_outcome"] == "author_refund+reporter_forfeit"
    ps = _payouts(contract)
    comp = [p for p in ps if p["reason"] == "false_report_comp"]
    assert comp and comp[0]["amount"] == 1_000_000_000_000
    assert comp[0]["to"] == item["author"]
    rep = json.loads(contract.get_reputation(item["reporter"]))
    assert rep["false_reports"] == 1


def test_overturned_restore_capped_by_pool(direct_vm, deploy, direct_owner,
                                           direct_bob):
    """When reporter rewards already spent part of the pool, an overturned
    appeal restores only what the pool still holds (documented cap)."""
    contract = deploy(appeal_resolve_cooldown_sec=60)
    url = "https://example.test/posts/capped"
    direct_vm.mock_web(url, {"status": 200, "body": SCAM_PAGE})
    mock_llm_pair(direct_vm, make_scores(scam=95), "REMOVE", confidence=99)
    direct_vm.sender = direct_owner
    item_id = contract.create_item("")
    direct_vm.value = 1_000_000_000_000
    contract.ingest(item_id, url)
    direct_vm.value = 0
    direct_vm.sender = direct_bob
    direct_vm.value = 1_000_000_000_000
    contract.report(item_id)
    direct_vm.value = 0
    direct_vm.sender = direct_owner
    contract.moderate(item_id)
    contract.enforce(item_id)   # forfeit 1e12 -> pool; reward -5e11 -> pool 5e11
    assert int(json.loads(contract.get_stats())["pool"]) == 500_000_000_000
    direct_vm.value = 2_000_000_000_000
    contract.appeal(item_id, "not a scam")  # author == ingester == owner
    direct_vm.value = 0
    warp(direct_vm, 61)
    direct_vm.clear_mocks()
    direct_vm.mock_web(url, {"status": 200, "body": SCAM_PAGE})
    direct_vm.mock_llm(r"TASK: EXTRACT", conftest.extract_reply("Some post text."))
    direct_vm.mock_llm(r"TASK: DECIDE", conftest.decide_reply(
        make_scores(), "APPROVE", confidence=90))
    contract.resolve_appeal(item_id)
    payouts = _payouts(contract)
    refund = [p for p in payouts if p["reason"] == "appeal_overturned_refund"]
    assert refund and refund[0]["amount"] == 2_500_000_000_000  # bond + capped restore
    assert int(json.loads(contract.get_stats())["pool"]) == 0


def test_pool_conservation(direct_vm, deploy, direct_owner, direct_bob):
    """Value in == value out: stakes + bonds == payouts + pool, always."""
    contract = deploy()
    total_in = 0
    urls = [(BENIGN_URL, BENIGN_PAGE, "APPROVE", make_scores()),
            (SCAM_URL, SCAM_PAGE, "REMOVE", make_scores(scam=95)),
            ("https://example.test/posts/flag", BENIGN_PAGE, "FLAG", make_scores(spam=60))]
    for i, (url, page, verdict, scores) in enumerate(urls):
        u = url + str(i)
        direct_vm.mock_web(u, {"status": 200, "body": page})
        mock_llm_pair(direct_vm, scores, verdict, confidence=90)
        direct_vm.sender = direct_owner
        item_id = contract.create_item("")
        direct_vm.value = 1_000_000_000_000
        contract.ingest(item_id, u)
        direct_vm.value = 0
        total_in += 1_000_000_000_000
        direct_vm.sender = direct_bob
        direct_vm.value = 1_000_000_000_000
        contract.report(item_id)
        direct_vm.value = 0
        total_in += 1_000_000_000_000
        direct_vm.sender = direct_owner
        contract.moderate(item_id)
        contract.enforce(item_id)
    stats = json.loads(contract.get_stats())
    assert total_in == stats["pool"] + stats["payouts_sum"]


def test_report_below_reputation_bond(direct_vm, deploy, direct_owner, direct_bob):
    contract = deploy()
    direct_vm.mock_web(BENIGN_URL, {"status": 200, "body": BENIGN_PAGE})
    mock_llm_pair(direct_vm, make_scores(), "APPROVE", confidence=95)
    direct_vm.sender = direct_owner
    item_id = contract.create_item("")
    direct_vm.value = 1_000_000_000_000
    contract.ingest(item_id, BENIGN_URL)
    direct_vm.value = 0
    direct_vm.sender = direct_bob
    direct_vm.value = 999_999_999_999
    with direct_vm.expect_revert("Reporter bond below"):
        contract.report(item_id)
    direct_vm.value = 0
