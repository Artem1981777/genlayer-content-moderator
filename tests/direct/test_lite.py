RULES = "No spam, scams, phishing, hate, harassment, violence, or threats."


def test_lite_initial_state(direct_vm, direct_deploy):
    contract = direct_deploy("contracts/moderator_lite.py", RULES, sdk_version="v0.2.16")
    state = contract.get_state()
    assert state["status"] == "created"
    assert state["verdict"] == ""
    assert contract.read_content() == ""
    assert contract.verify_content("anything") is False
