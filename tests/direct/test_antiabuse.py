"""Anti-abuse guards and reputation mechanics."""
import json

from conftest import (BENIGN_PAGE, BENIGN_URL, SCAM_PAGE, SCAM_URL,
                      make_scores, mock_llm_pair, warp)


def _setup(direct_vm, contract, owner, url=BENIGN_URL, page=BENIGN_PAGE, verdict="APPROVE"):
    direct_vm.mock_web(url, {"status": 200, "body": page})
    mock_llm_pair(direct_vm, make_scores(), verdict, confidence=95)
    direct_vm.sender = owner
    item_id = contract.create_item("")
    direct_vm.value = 1_000_000_000_000
    contract.ingest(item_id, url)
    direct_vm.value = 0
    return item_id


def test_self_report_banned(direct_vm, deploy, direct_owner):
    contract = deploy()
    item_id = _setup(direct_vm, contract, direct_owner)
    direct_vm.value = 1_000_000_000_000
    with direct_vm.expect_revert("Self-report not allowed"):
        contract.report(item_id)
    direct_vm.value = 0


def test_open_report_cap(direct_vm, deploy, direct_owner, direct_bob):
    contract = deploy(max_open_reports=2)
    ids = [_setup(direct_vm, contract, direct_owner, BENIGN_URL + str(i), BENIGN_PAGE)
           for i in range(3)]
    direct_vm.sender = direct_bob
    direct_vm.value = 1_000_000_000_000
    contract.report(ids[0])
    contract.report(ids[1])
    with direct_vm.expect_revert("Too many open reports"):
        contract.report(ids[2])
    direct_vm.value = 0


def test_cap_frees_after_enforcement(direct_vm, deploy, direct_owner, direct_bob):
    contract = deploy(max_open_reports=1)
    id0 = _setup(direct_vm, contract, direct_owner, BENIGN_URL + "a", BENIGN_PAGE)
    direct_vm.sender = direct_bob
    direct_vm.value = 1_000_000_000_000
    contract.report(id0)
    direct_vm.value = 0
    id1 = _setup(direct_vm, contract, direct_owner, BENIGN_URL + "b", BENIGN_PAGE)
    direct_vm.sender = direct_bob
    direct_vm.value = 1_000_000_000_000
    with direct_vm.expect_revert("Too many open reports"):
        contract.report(id1)
    direct_vm.value = 0
    direct_vm.sender = direct_owner
    contract.moderate(id0)
    contract.enforce(id0)  # report settles, load decrements
    direct_vm.sender = direct_bob
    direct_vm.value = 1_000_000_000_000
    contract.report(id1)
    direct_vm.value = 0


def test_item_reported_once(direct_vm, deploy, direct_owner, direct_bob, direct_alice):
    contract = deploy()
    item_id = _setup(direct_vm, contract, direct_owner)
    direct_vm.sender = direct_bob
    direct_vm.value = 1_000_000_000_000
    contract.report(item_id)
    direct_vm.value = 0
    direct_vm.sender = direct_alice
    direct_vm.value = 1_000_000_000_000
    with direct_vm.expect_revert("Item already reported"):
        contract.report(item_id)
    direct_vm.value = 0


def test_report_on_enforced_rejected(direct_vm, deploy, direct_owner, direct_bob):
    contract = deploy()
    item_id = _setup(direct_vm, contract, direct_owner)
    direct_vm.sender = direct_owner
    contract.moderate(item_id)
    contract.enforce(item_id)
    direct_vm.sender = direct_bob
    direct_vm.value = 1_000_000_000_000
    with direct_vm.expect_revert("not reportable"):
        contract.report(item_id)
    direct_vm.value = 0


def test_open_appeal_cap(direct_vm, deploy, direct_owner, direct_alice):
    contract = deploy(max_open_appeals=1)
    ids = []
    for i in range(2):
        direct_vm.mock_web(SCAM_URL + str(i), {"status": 200, "body": SCAM_PAGE})
        mock_llm_pair(direct_vm, make_scores(scam=95), "REMOVE", confidence=99)
        direct_vm.sender = direct_alice  # alice ingests -> alice is the author
        item_id = contract.create_item("")
        direct_vm.value = 1_000_000_000_000
        contract.ingest(item_id, SCAM_URL + str(i))
        direct_vm.value = 0
        direct_vm.sender = direct_owner  # moderation/enforcement are owner actions
        contract.moderate(item_id)
        contract.enforce(item_id)
        ids.append(item_id)
    direct_vm.sender = direct_alice
    direct_vm.value = 2_000_000_000_000
    contract.appeal(ids[0], "not a scam")
    with direct_vm.expect_revert("Too many open appeals"):
        contract.appeal(ids[1], "not a scam")
    direct_vm.value = 0


def test_reputation_discount_for_honest_reporter(direct_vm, deploy, direct_owner, direct_bob):
    contract = deploy()
    bond_full = 1_000_000_000_000
    # settle 3 honest reports (false reports on clean content are NOT honest,
    # so use REMOVE-verdict content for honest reporting)
    for i in range(3):
        url = SCAM_URL + str(i)
        direct_vm.mock_web(url, {"status": 200, "body": SCAM_PAGE})
        mock_llm_pair(direct_vm, make_scores(scam=95), "REMOVE", confidence=99)
        direct_vm.sender = direct_owner
        item_id = contract.create_item("")
        direct_vm.value = bond_full
        contract.ingest(item_id, url)
        direct_vm.value = 0
        direct_vm.sender = direct_bob
        direct_vm.value = bond_full
        contract.report(item_id)
        direct_vm.value = 0
        direct_vm.sender = direct_owner
        contract.moderate(item_id)
        contract.enforce(item_id)
    item = json.loads(contract.get_all_items(0, 50, ""))["items"][0]
    rep = json.loads(contract.get_reputation(item["reporter"]))
    assert rep["honest_reports"] == 3
    assert rep["required_report_bond"] == 800_000_000_000  # 80% discount
    direct_vm.sender = direct_bob
    next_url = BENIGN_URL + "_next"
    direct_vm.mock_web(next_url, {"status": 200, "body": BENIGN_PAGE})
    mock_llm_pair(direct_vm, make_scores(), "APPROVE", confidence=95)
    direct_vm.sender = direct_owner
    item_id = contract.create_item("")
    direct_vm.value = bond_full
    contract.ingest(item_id, next_url)
    direct_vm.value = 0
    direct_vm.sender = direct_bob
    direct_vm.value = 800_000_000_000  # discounted bond accepted
    contract.report(item_id)
    direct_vm.value = 0


def test_no_discount_with_false_reports(direct_vm, deploy, direct_owner, direct_bob):
    contract = deploy()
    # two false reports on clean content -> below the 70% honesty bar
    for i in range(2):
        url = BENIGN_URL + str(i)
        direct_vm.mock_web(url, {"status": 200, "body": BENIGN_PAGE})
        mock_llm_pair(direct_vm, make_scores(), "APPROVE", confidence=95)
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
        contract.enforce(item_id)
    item = json.loads(contract.get_all_items(0, 50, ""))["items"][0]
    rep = json.loads(contract.get_reputation(item["reporter"]))
    assert rep["false_reports"] == 2
    assert rep["required_report_bond"] == 1_000_000_000_000  # full bond


def test_fund_pool_owner_only(direct_vm, deploy, direct_owner, direct_bob):
    contract = deploy()
    direct_vm.sender = direct_bob
    direct_vm.value = 1_000_000_000_000
    with direct_vm.expect_revert("Only owner can fund"):
        contract.fund_pool()
    direct_vm.value = 0
    direct_vm.sender = direct_owner
    direct_vm.value = 5_000_000_000_000
    contract.fund_pool()
    direct_vm.value = 0
    assert int(json.loads(contract.get_config())["pool"]) == 5_000_000_000_000


def test_release_url_owner_only(direct_vm, deploy, direct_owner, direct_bob):
    contract = deploy()
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("Only owner can release"):
        contract.release_url(BENIGN_URL)
    direct_vm.sender = direct_owner
    contract.release_url(BENIGN_URL)
    assert contract.get_item_by_url(BENIGN_URL) == ""
