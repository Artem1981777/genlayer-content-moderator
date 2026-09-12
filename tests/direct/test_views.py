"""Index and pagination views, stats, batch moderation."""
import json

import conftest
from conftest import (BENIGN_PAGE, BENIGN_URL, SCAM_PAGE, SCAM_URL,
                      make_scores, mock_llm_pair, full_item)


def _seed_three(direct_vm, contract, owner):
    ids = []
    specs = [
        (BENIGN_URL + "1", BENIGN_PAGE, make_scores(), "APPROVE"),
        (SCAM_URL + "2", SCAM_PAGE, make_scores(scam=95), "REMOVE"),
        (BENIGN_URL + "3", BENIGN_PAGE, make_scores(spam=60), "FLAG"),
    ]
    for url, page, scores, verdict in specs:
        ids.append(full_item(direct_vm, contract, owner, url, page, scores, verdict))
    return ids


def test_get_all_items_pagination(direct_vm, deploy, direct_owner):
    contract = deploy()
    _seed_three(direct_vm, contract, direct_owner)
    page0 = json.loads(contract.get_all_items(0, 2, ""))
    assert page0["total"] == 3 and len(page0["items"]) == 2
    page1 = json.loads(contract.get_all_items(2, 2, ""))
    assert len(page1["items"]) == 1
    ids = [it["id"] for it in page0["items"]] + [page1["items"][0]["id"]]
    assert len(set(ids)) == 3


def test_get_all_items_status_filter(direct_vm, deploy, direct_owner):
    contract = deploy()
    _seed_three(direct_vm, contract, direct_owner)
    enforced = json.loads(contract.get_all_items(0, 50, "enforced"))
    assert enforced["total"] == 3
    created = json.loads(contract.get_all_items(0, 50, "created"))
    assert created["total"] == 0


def test_get_items_by_author(direct_vm, deploy, direct_owner, direct_alice):
    contract = deploy()
    _seed_three(direct_vm, contract, direct_owner)
    mine = full_item(direct_vm, contract, direct_alice, SCAM_URL + "9", SCAM_PAGE,
                     make_scores(scam=95), "REMOVE", enforcer=direct_owner)
    items = json.loads(contract.get_all_items(0, 50, ""))["items"]
    owner_addr = next(it for it in items if it["id"] == mine)["author"]
    res = json.loads(contract.get_items_by_author(owner_addr))
    assert res["total"] == 1
    assert res["items"][0]["id"] == mine
    other = json.loads(contract.get_items_by_author("0x" + "ff" * 20))
    assert other["total"] == 0


def test_get_items_by_reporter(direct_vm, deploy, direct_owner, direct_bob):
    contract = deploy()
    direct_vm.mock_web(SCAM_URL + "r", {"status": 200, "body": SCAM_PAGE})
    mock_llm_pair(direct_vm, make_scores(scam=95), "REMOVE", confidence=99)
    direct_vm.sender = direct_owner
    item_id = contract.create_item("")
    direct_vm.value = 1_000_000_000_000
    contract.ingest(item_id, SCAM_URL + "r")
    direct_vm.value = 0
    direct_vm.sender = direct_bob
    direct_vm.value = 1_000_000_000_000
    contract.report(item_id)
    direct_vm.value = 0
    items = json.loads(contract.get_all_items(0, 50, ""))["items"]
    reporter_addr = items[0]["reporter"]
    res = json.loads(contract.get_items_by_reporter(reporter_addr))
    assert res["total"] == 1 and res["items"][0]["id"] == item_id


def test_get_stats(direct_vm, deploy, direct_owner):
    contract = deploy()
    _seed_three(direct_vm, contract, direct_owner)
    stats = json.loads(contract.get_stats())
    assert stats["total"] == 3
    assert stats["by_status"] == {"enforced": 3}
    assert stats["by_verdict"] == {"APPROVE": 1, "REMOVE": 1, "FLAG": 1}
    assert stats["pool"] == 1_500_000_000_000  # full forfeit + half forfeit


def test_get_payouts_pagination(direct_vm, deploy, direct_owner):
    contract = deploy()
    _seed_three(direct_vm, contract, direct_owner)  # approve + flag produce payouts
    p = json.loads(contract.get_payouts(0, 1))
    assert p["total"] >= 1 and len(p["payouts"]) == 1
    p2 = json.loads(contract.get_payouts(p["total"], 10))
    assert p2["payouts"] == []


def test_moderate_batch(direct_vm, deploy, direct_owner, direct_alice):
    contract = deploy()
    ids = []
    specs = (("APPROVE", make_scores(), 0),
             ("REMOVE", make_scores(scam=95), 1),
             ("FLAG", make_scores(spam=60), 2))
    for verdict, scores, i in specs:
        url = BENIGN_URL + "b" + str(i)
        page_text = f"page-{i}-marker"
        content = f"content-{i}-marker"
        page = f"<html><body><p>{page_text}</p></body></html>"
        # per-item mock routing: EXTRACT prompts contain the page text,
        # DECIDE prompts contain the extracted content
        direct_vm.mock_web(url, {"status": 200, "body": page})
        direct_vm.mock_llm(rf"PAGE BEGIN ===\n<html><body><p>{page_text}",
                           conftest.extract_reply(content))
        direct_vm.mock_llm(rf"CONTENT BEGIN ===\n{content}",
                           conftest.decide_reply(scores, verdict, confidence=90))
        direct_vm.sender = direct_alice
        item_id = contract.create_item("")
        direct_vm.value = 1_000_000_000_000
        contract.ingest(item_id, url)
        direct_vm.value = 0
        ids.append(item_id)
    direct_vm.sender = direct_owner
    result = json.loads(contract.moderate_batch(ids))
    assert [r["verdict"] for r in result] == ["APPROVE", "REMOVE", "FLAG"]
    assert all(r["ok"] for r in result)


def test_moderate_batch_size_limit(direct_vm, deploy, direct_owner):
    contract = deploy()
    six = json.dumps(["a", "b", "c", "d", "e", "f"])
    with direct_vm.expect_revert("Batch limited"):
        contract.moderate_batch(["a", "b", "c", "d", "e", "f"])


def test_moderate_batch_individual_errors(direct_vm, deploy, direct_owner, direct_alice):
    contract = deploy()
    url = BENIGN_URL + "batch"
    direct_vm.mock_web(url, {"status": 200, "body": BENIGN_PAGE})
    mock_llm_pair(direct_vm, make_scores(), "APPROVE", confidence=90)
    direct_vm.sender = direct_alice
    item_id = contract.create_item("")
    direct_vm.value = 1_000_000_000_000
    contract.ingest(item_id, url)
    direct_vm.value = 0
    direct_vm.sender = direct_owner
    result = json.loads(contract.moderate_batch([item_id, "missing_id"]))
    assert result[0]["ok"] is True
    assert result[1]["ok"] is False
    assert "Unknown item_id" in result[1]["error"]


def test_history_timeline(direct_vm, deploy, direct_owner):
    contract = deploy()
    item_id = full_item(direct_vm, contract, direct_owner, SCAM_URL, SCAM_PAGE,
                        make_scores(scam=95), "REMOVE")
    item = json.loads(contract.get_item(item_id))
    actions = [h["action"] for h in item["history"]]
    assert actions == ["create_item", "ingest", "moderate", "enforce"]
    assert all("by" in h and h["ts"] > 0 for h in item["history"])
