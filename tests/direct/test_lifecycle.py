"""Item lifecycle: create -> ingest -> moderate -> enforce (+ permissionless)."""
import json

from conftest import (BENIGN_PAGE, BENIGN_URL, SCAM_PAGE, SCAM_URL,
                      make_scores, mock_llm_pair, warp)


def test_create_item(direct_vm, deploy, direct_owner):
    contract = deploy()
    direct_vm.sender = direct_owner
    item_id = contract.create_item("")
    item = json.loads(contract.get_item(item_id))
    assert item["status"] == "created"
    assert item["creator"] and item["author"] == ""
    assert item["history"][0]["action"] == "create_item"


def test_ingest_then_moderate_stores_content(direct_vm, deploy, direct_owner):
    contract = deploy()
    direct_vm.mock_web(BENIGN_URL, {"status": 200, "body": BENIGN_PAGE})
    direct_vm.mock_llm(r"TASK: EXTRACT", json.dumps(
        {"main_text": "Many people enjoy hiking in the mountains on weekends.",
         "claims": [], "has_embedded_instructions": False}))
    mock_llm_pair(direct_vm, make_scores(), "APPROVE", confidence=95)
    direct_vm.sender = direct_owner
    item_id = contract.create_item("")
    direct_vm.value = 1_000_000_000_000
    contract.ingest(item_id, BENIGN_URL)
    direct_vm.value = 0
    item = json.loads(contract.get_item(item_id))
    assert item["status"] == "ingested"
    assert item["author"]
    assert item["author_stake"] == 1_000_000_000_000
    # content is fetched under consensus at moderate, then stored with its hash
    contract.moderate(item_id)
    item = json.loads(contract.get_item(item_id))
    assert "hiking" in item["content"]
    assert len(item["content_hash"]) == 64
    assert contract.verify_content(item_id) is True


def test_ingest_below_min_stake(direct_vm, deploy, direct_owner):
    contract = deploy()
    direct_vm.sender = direct_owner
    item_id = contract.create_item("")
    direct_vm.value = 999_999_999_999
    with direct_vm.expect_revert("Author stake below minimum"):
        contract.ingest(item_id, BENIGN_URL)
    direct_vm.value = 0


def test_ingest_twice(direct_vm, deploy, direct_owner):
    contract = deploy()
    direct_vm.mock_web(BENIGN_URL, {"status": 200, "body": BENIGN_PAGE})
    direct_vm.sender = direct_owner
    item_id = contract.create_item("")
    direct_vm.value = 1_000_000_000_000
    contract.ingest(item_id, BENIGN_URL)
    with direct_vm.expect_revert("Item already ingested"):
        contract.ingest(item_id, BENIGN_URL)
    direct_vm.value = 0


def test_ingest_rejects_non_http(direct_vm, deploy, direct_owner):
    contract = deploy()
    direct_vm.sender = direct_owner
    item_id = contract.create_item("")
    direct_vm.value = 1_000_000_000_000
    with direct_vm.expect_revert("[EXTERNAL] only http(s)"):
        contract.ingest(item_id, "ftp://example.test/file")
    direct_vm.value = 0


def test_ingest_rejects_long_url(direct_vm, deploy, direct_owner):
    contract = deploy()
    direct_vm.sender = direct_owner
    item_id = contract.create_item("")
    direct_vm.value = 1_000_000_000_000
    with direct_vm.expect_revert("[EXTERNAL] url exceeds"):
        contract.ingest(item_id, "https://example.test/" + "a" * 600)
    direct_vm.value = 0


def test_moderate_empty_page_external_error(direct_vm, deploy, direct_owner):
    contract = deploy()
    direct_vm.mock_web(BENIGN_URL, {"status": 200, "body": ""})
    direct_vm.sender = direct_owner
    item_id = contract.create_item("")
    direct_vm.value = 1_000_000_000_000
    contract.ingest(item_id, BENIGN_URL)
    direct_vm.value = 0
    with direct_vm.expect_revert("[EXTERNAL] source is empty"):
        contract.moderate(item_id)


def test_duplicate_url_guard(direct_vm, deploy, direct_owner, direct_alice):
    contract = deploy()
    direct_vm.mock_web(BENIGN_URL, {"status": 200, "body": BENIGN_PAGE})
    direct_vm.mock_llm(r"TASK: EXTRACT", json.dumps(
        {"main_text": "Some text.", "claims": [], "has_embedded_instructions": False}))
    direct_vm.mock_llm(r"TASK: DECIDE", json.dumps(
        {"scores": make_scores(), "injection_attempt": 0,
         "verdict": "APPROVE", "confidence": 95, "rationale": "clean"}))
    direct_vm.sender = direct_owner
    id1 = contract.create_item("")
    direct_vm.value = 1_000_000_000_000
    contract.ingest(id1, BENIGN_URL)
    direct_vm.sender = direct_alice
    id2 = contract.create_item("")
    direct_vm.value = 1_000_000_000_000
    with direct_vm.expect_revert("already under active moderation"):
        contract.ingest(id2, BENIGN_URL)
    direct_vm.value = 0


def test_url_reusable_after_enforcement(direct_vm, deploy, direct_owner, direct_alice):
    contract = deploy()
    direct_vm.mock_web(BENIGN_URL, {"status": 200, "body": BENIGN_PAGE})
    mock_llm_pair(direct_vm, make_scores(), "APPROVE", confidence=95)
    direct_vm.sender = direct_owner
    id1 = contract.create_item("")
    direct_vm.value = 1_000_000_000_000
    contract.ingest(id1, BENIGN_URL)
    direct_vm.value = 0
    contract.moderate(id1)
    contract.enforce(id1)
    direct_vm.sender = direct_alice
    id2 = contract.create_item("")
    direct_vm.value = 1_000_000_000_000
    contract.ingest(id2, BENIGN_URL)  # no revert: first item is no longer active
    direct_vm.value = 0
    assert json.loads(contract.get_item(id2))["status"] == "ingested"


def test_moderate_and_enforce_owner(direct_vm, deploy, direct_owner):
    contract = deploy()
    direct_vm.mock_web(SCAM_URL, {"status": 200, "body": SCAM_PAGE})
    mock_llm_pair(direct_vm, make_scores(scam=95), "REMOVE", confidence=99)
    direct_vm.sender = direct_owner
    item_id = contract.create_item("")
    direct_vm.value = 1_000_000_000_000
    contract.ingest(item_id, SCAM_URL)
    direct_vm.value = 0
    contract.moderate(item_id)
    item = json.loads(contract.get_item(item_id))
    assert item["status"] == "moderated"
    assert item["verdict"] == "REMOVE"
    assert item["verdict_ts"] > 0
    contract.enforce(item_id)
    item = json.loads(contract.get_item(item_id))
    assert item["status"] == "enforced"
    assert item["enforcement_action"] == "removed"
    assert item["blocked"] is True
    assert contract.read_content(item_id) == "[content removed by moderation]"


def test_moderate_requires_ingest(direct_vm, deploy, direct_owner):
    contract = deploy()
    direct_vm.sender = direct_owner
    item_id = contract.create_item("")
    with direct_vm.expect_revert("cannot be moderated"):
        contract.moderate(item_id)


def test_enforce_permissionless_after_timeout(direct_vm, deploy, direct_owner, direct_alice):
    contract = deploy()
    direct_vm.mock_web(BENIGN_URL, {"status": 200, "body": BENIGN_PAGE})
    mock_llm_pair(direct_vm, make_scores(), "APPROVE", confidence=95)
    direct_vm.sender = direct_owner
    item_id = contract.create_item("")
    direct_vm.value = 1_000_000_000_000
    contract.ingest(item_id, BENIGN_URL)
    direct_vm.value = 0
    contract.moderate(item_id)
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("Only owner can enforce"):
        contract.enforce(item_id)
    warp(direct_vm, 3600)
    contract.enforce(item_id)  # permissionless after ENFORCE_TIMEOUT_SEC
    item = json.loads(contract.get_item(item_id))
    assert item["status"] == "enforced"
    assert any("permissionless" in h["note"] for h in item["history"])
