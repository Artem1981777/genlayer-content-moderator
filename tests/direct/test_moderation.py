"""Moderation consensus: threshold verdicts, injection detection, malformed
fallback, error classification, and code-defined validator agreement."""
import json

import conftest
from conftest import (BENIGN_PAGE, BENIGN_URL, INJECT_PAGE, INJECT_URL,
                      make_scores, mock_llm_pair, warp)


def _ingest(direct_vm, contract, account, url, page):
    direct_vm.mock_web(url, {"status": 200, "body": page})
    direct_vm.sender = account
    item_id = contract.create_item("")
    direct_vm.value = 1_000_000_000_000
    contract.ingest(item_id, url)
    direct_vm.value = 0
    return item_id


def test_approve(direct_vm, deploy, direct_owner):
    contract = deploy()
    item_id = _ingest(direct_vm, contract, direct_owner, BENIGN_URL, BENIGN_PAGE)
    mock_llm_pair(direct_vm, make_scores(), "APPROVE", confidence=95)
    contract.moderate(item_id)
    item = json.loads(contract.get_item(item_id))
    assert item["verdict"] == "APPROVE"
    assert item["scores"]["scam"] == 0
    assert item["needs_review"] is False


def test_flag_by_threshold(direct_vm, deploy, direct_owner):
    contract = deploy()
    item_id = _ingest(direct_vm, contract, direct_owner, BENIGN_URL, BENIGN_PAGE)
    mock_llm_pair(direct_vm, make_scores(spam=60), "FLAG", confidence=70)
    contract.moderate(item_id)
    item = json.loads(contract.get_item(item_id))
    assert item["verdict"] == "FLAG"
    assert item["scores"]["spam"] == 60


def test_remove_by_threshold(direct_vm, deploy, direct_owner):
    contract = deploy()
    item_id = _ingest(direct_vm, contract, direct_owner, BENIGN_URL, BENIGN_PAGE)
    mock_llm_pair(direct_vm, make_scores(scam=90), "REMOVE", confidence=99)
    contract.moderate(item_id)
    assert json.loads(contract.get_item(item_id))["verdict"] == "REMOVE"


def test_custom_thresholds_change_verdict(direct_vm, deploy, direct_owner):
    contract = deploy()
    direct_vm.sender = direct_owner
    contract.set_thresholds("spam", 3000, 8000)  # FLAG from score 30
    item_id = _ingest(direct_vm, contract, direct_owner, BENIGN_URL, BENIGN_PAGE)
    mock_llm_pair(direct_vm, make_scores(spam=35), "APPROVE", confidence=80)
    contract.moderate(item_id)
    item = json.loads(contract.get_item(item_id))
    assert item["verdict"] == "FLAG"  # recomputed from thresholds, not the mock verdict


def test_threshold_boundary_exact(direct_vm, deploy, direct_owner):
    contract = deploy()
    direct_vm.sender = direct_owner
    contract.set_thresholds("spam", 5000, 5000)  # score 50 -> REMOVE
    item_id = _ingest(direct_vm, contract, direct_owner, BENIGN_URL, BENIGN_PAGE)
    mock_llm_pair(direct_vm, make_scores(spam=50), "FLAG", confidence=80)
    contract.moderate(item_id)
    assert json.loads(contract.get_item(item_id))["verdict"] == "REMOVE"


def test_injection_auto_flag(direct_vm, deploy, direct_owner):
    contract = deploy()
    item_id = _ingest(direct_vm, contract, direct_owner, INJECT_URL, INJECT_PAGE)
    mock_llm_pair(direct_vm, make_scores(), "APPROVE", injection=80, confidence=90)
    contract.moderate(item_id)
    item = json.loads(contract.get_item(item_id))
    assert item["verdict"] == "FLAG"
    assert item["injection_detected"] is True
    assert item["injection_attempt"] == 80


def test_injection_below_band_not_detected(direct_vm, deploy, direct_owner):
    contract = deploy()
    item_id = _ingest(direct_vm, contract, direct_owner, BENIGN_URL, BENIGN_PAGE)
    mock_llm_pair(direct_vm, make_scores(), "APPROVE", injection=40, confidence=90)
    contract.moderate(item_id)
    item = json.loads(contract.get_item(item_id))
    assert item["verdict"] == "APPROVE"
    assert item["injection_detected"] is False


def test_malformed_decide_canonical_flag(direct_vm, deploy, direct_owner):
    contract = deploy()
    item_id = _ingest(direct_vm, contract, direct_owner, BENIGN_URL, BENIGN_PAGE)
    direct_vm.mock_llm(r"TASK: EXTRACT", conftest.extract_reply("Some text."))
    direct_vm.mock_llm(r"TASK: DECIDE", "I cannot answer that in JSON, sorry!")
    contract.moderate(item_id)
    item = json.loads(contract.get_item(item_id))
    assert item["verdict"] == "FLAG"
    assert item["confidence"] == 0
    assert item["needs_review"] is True
    assert "unparseable" in item["reason"]


def test_extract_llm_error_classification(direct_vm, deploy, direct_owner):
    contract = deploy()
    item_id = _ingest(direct_vm, contract, direct_owner, BENIGN_URL, BENIGN_PAGE)
    direct_vm.mock_llm(r"TASK: EXTRACT", "not json at all {{{")
    with direct_vm.expect_revert("[LLM_ERROR]"):
        contract.moderate(item_id)


def test_fetch_unavailable_external_error(direct_vm, deploy, direct_owner):
    contract = deploy()
    item_id = _ingest(direct_vm, contract, direct_owner, BENIGN_URL, BENIGN_PAGE)
    direct_vm.clear_mocks()  # no web mock -> fetch fails
    with direct_vm.expect_revert("[EXTERNAL]"):
        contract.moderate(item_id)


def test_validator_agrees_within_tolerance(direct_vm, deploy, direct_owner):
    contract = deploy()
    item_id = _ingest(direct_vm, contract, direct_owner, BENIGN_URL, BENIGN_PAGE)
    mock_llm_pair(direct_vm, make_scores(spam=60), "FLAG", confidence=70)
    contract.moderate(item_id)
    # validator sees slightly different scores (delta 10 <= 15): agree
    direct_vm.clear_mocks()
    direct_vm.mock_web(BENIGN_URL, {"status": 200, "body": BENIGN_PAGE})
    direct_vm.mock_llm(r"TASK: EXTRACT", conftest.extract_reply("Some post text."))
    direct_vm.mock_llm(r"TASK: DECIDE", conftest.decide_reply(make_scores(spam=70), "FLAG", confidence=70))
    assert direct_vm.run_validator() is True


def test_validator_disagrees_on_verdict(direct_vm, deploy, direct_owner):
    contract = deploy()
    item_id = _ingest(direct_vm, contract, direct_owner, BENIGN_URL, BENIGN_PAGE)
    mock_llm_pair(direct_vm, make_scores(spam=60), "FLAG", confidence=70)
    contract.moderate(item_id)
    direct_vm.clear_mocks()
    direct_vm.mock_web(BENIGN_URL, {"status": 200, "body": BENIGN_PAGE})
    direct_vm.mock_llm(r"TASK: EXTRACT", conftest.extract_reply("Some post text."))
    direct_vm.mock_llm(r"TASK: DECIDE", conftest.decide_reply(make_scores(scam=90), "REMOVE", confidence=90))
    assert direct_vm.run_validator() is False


def test_validator_disagrees_on_score_delta(direct_vm, deploy, direct_owner):
    contract = deploy()
    item_id = _ingest(direct_vm, contract, direct_owner, BENIGN_URL, BENIGN_PAGE)
    mock_llm_pair(direct_vm, make_scores(spam=60), "FLAG", confidence=70)
    contract.moderate(item_id)
    direct_vm.clear_mocks()
    direct_vm.mock_web(BENIGN_URL, {"status": 200, "body": BENIGN_PAGE})
    direct_vm.mock_llm(r"TASK: EXTRACT", conftest.extract_reply("Some post text."))
    direct_vm.mock_llm(r"TASK: DECIDE", conftest.decide_reply(make_scores(spam=76), "FLAG", confidence=70))
    assert direct_vm.run_validator() is False  # delta 16 > tolerance 15, same verdict


def test_validator_injection_band_disagreement(direct_vm, deploy, direct_owner):
    contract = deploy()
    item_id = _ingest(direct_vm, contract, direct_owner, BENIGN_URL, BENIGN_PAGE)
    mock_llm_pair(direct_vm, make_scores(), "APPROVE", injection=40, confidence=90)
    contract.moderate(item_id)
    direct_vm.clear_mocks()
    direct_vm.mock_web(BENIGN_URL, {"status": 200, "body": BENIGN_PAGE})
    direct_vm.mock_llm(r"TASK: EXTRACT", conftest.extract_reply("Some post text."))
    # validator sees an injection attempt (60 > 50) while leader had 40 -> disagree
    direct_vm.mock_llm(r"TASK: DECIDE", conftest.decide_reply(make_scores(), "APPROVE", injection=60, confidence=90))
    assert direct_vm.run_validator() is False


def test_validator_agrees_on_identical_leader_error(direct_vm, deploy, direct_owner):
    contract = deploy()
    item_id = _ingest(direct_vm, contract, direct_owner, BENIGN_URL, BENIGN_PAGE)
    mock_llm_pair(direct_vm, make_scores(), "APPROVE", confidence=95)
    contract.moderate(item_id)
    direct_vm.clear_mocks()  # validator's re-run hits the same missing-source error
    msg = ("[EXTERNAL] source unavailable: No web mock for WebRender " + BENIGN_URL +
           "\n  Registered: (none)")
    assert direct_vm.run_validator(leader_error=Exception(msg)) is True


def test_validator_disagrees_when_leader_errored_but_validator_succeeds(direct_vm, deploy, direct_owner):
    contract = deploy()
    item_id = _ingest(direct_vm, contract, direct_owner, BENIGN_URL, BENIGN_PAGE)
    mock_llm_pair(direct_vm, make_scores(), "APPROVE", confidence=95)
    contract.moderate(item_id)
    # mocks still in place -> validator's re-run succeeds while leader "errored"
    assert direct_vm.run_validator(leader_error=Exception("[EXTERNAL] boom")) is False


def test_rerun_gate_and_cooldown(direct_vm, deploy, direct_owner, direct_alice, direct_bob):
    contract = deploy()
    item_id = _ingest(direct_vm, contract, direct_owner, BENIGN_URL, BENIGN_PAGE)
    mock_llm_pair(direct_vm, make_scores(), "APPROVE", confidence=95)
    contract.moderate(item_id)
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("Re-moderation allowed only"):
        contract.moderate(item_id)
    # owner may re-run, but cooldown applies
    direct_vm.sender = direct_owner
    with direct_vm.expect_revert("cooldown active"):
        contract.moderate(item_id)
    warp(direct_vm, 61)
    contract.moderate(item_id)  # owner after cooldown
    # a reporter unlocks re-moderation for anyone
    direct_vm.sender = direct_bob
    direct_vm.value = 1_000_000_000_000
    contract.report(item_id)
    direct_vm.value = 0
    warp(direct_vm, 61)
    direct_vm.sender = direct_alice
    contract.moderate(item_id)
