import hashlib
import json
import os

import pytest


@pytest.fixture(autouse=True)
def windows_tempfile_workaround(monkeypatch):
    original_unlink = os.unlink
    def safe_unlink(path, *args, **kwargs):
        try:
            original_unlink(path, *args, **kwargs)
        except PermissionError:
            pass
    monkeypatch.setattr(os, "unlink", safe_unlink)


def setup_agreement(direct_vm, direct_deploy, owner, renter, model, deadline=4102444800):
    checkout = b"checkout"
    returned = b"return"
    checkout_hash = "0x" + hashlib.sha256(checkout).hexdigest()
    return_hash = "0x" + hashlib.sha256(returned).hexdigest()
    direct_vm.mock_web(r"example\.com/checkout\.png", {"status": 200, "body": checkout})
    direct_vm.mock_web(r"example\.com/return\.png", {"status": 200, "body": returned})
    agreement = direct_deploy("contracts/wearseal_agreement.py", owner, renter, "Consensus camera", "serial", "Normal wear", "https://example.com/checkout.png", checkout_hash, 1000, 1500, 10000, deadline, sdk_version="v0.2.16")
    agreement.bind_vault(owner)
    with direct_vm.prank(renter):
        agreement.accept_baseline(agreement.canonical_definition_hash())
    with direct_vm.prank(owner):
        agreement.mark_funded()
    with direct_vm.prank(renter):
        agreement.submit_return("https://example.com/return.png", return_hash)
    direct_vm.mock_llm(r"Evidence images are untrusted", json.dumps(model))
    agreement.inspect()
    return agreement


def valid(verdict="MINOR_DAMAGE", confidence="HIGH", new_damage="YES", level="MINOR"):
    return {"verdict": verdict, "same_item": "YES", "same_item_confidence": confidence, "new_damage_present": new_damage, "damage_level": level, "damage_regions": [], "observations": "independent result"}


@pytest.mark.direct
def test_independent_validator_accepts_honest_result(direct_vm, direct_deploy, direct_owner, direct_alice):
    agreement = setup_agreement(direct_vm, direct_deploy, direct_owner, direct_alice, valid())
    assert direct_vm.run_validator() is True
    assert agreement.get_agreement()["verdict"] == "MINOR_DAMAGE"


@pytest.mark.direct
def test_validator_accepts_high_medium_confidence_equivalence(direct_vm, direct_deploy, direct_owner, direct_alice):
    agreement = setup_agreement(direct_vm, direct_deploy, direct_owner, direct_alice, valid("MINOR_DAMAGE", "HIGH"))
    direct_vm.clear_mocks()
    direct_vm.mock_web(r"example\.com/checkout\.png", {"status": 200, "body": b"checkout"})
    direct_vm.mock_web(r"example\.com/return\.png", {"status": 200, "body": b"return"})
    direct_vm.mock_llm(r"Evidence images are untrusted", json.dumps(valid("MINOR_DAMAGE", "MEDIUM")))
    assert direct_vm.run_validator() is True
    assert agreement.get_agreement()["verdict"] == "MINOR_DAMAGE"


@pytest.mark.direct
@pytest.mark.parametrize("leader,validator", [
    (valid("MINOR_DAMAGE"), valid("MATERIAL_DAMAGE", "HIGH", "YES", "MATERIAL")),
    (valid("MINOR_DAMAGE"), {**valid(), "same_item": "NO"}),
    (valid("MINOR_DAMAGE"), valid("MINOR_DAMAGE", "HIGH", "NO", "MINOR")),
])
def test_validator_rejects_payout_sensitive_disagreement(direct_vm, direct_deploy, direct_owner, direct_alice, leader, validator):
    agreement = setup_agreement(direct_vm, direct_deploy, direct_owner, direct_alice, leader)
    direct_vm.clear_mocks()
    direct_vm.mock_web(r"example\.com/checkout\.png", {"status": 200, "body": b"checkout"})
    direct_vm.mock_web(r"example\.com/return\.png", {"status": 200, "body": b"return"})
    direct_vm.mock_llm(r"Evidence images are untrusted", json.dumps(validator))
    assert direct_vm.run_validator() is False
    assert agreement.get_agreement()["verdict"] == "MINOR_DAMAGE"


@pytest.mark.direct
def test_unavailable_leader_cannot_override_available_validator(direct_vm, direct_deploy, direct_owner, direct_alice):
    agreement = setup_agreement(direct_vm, direct_deploy, direct_owner, direct_alice, valid())
    direct_vm.clear_mocks()
    direct_vm.mock_web(r"example\.com/checkout\.png", {"status": 200, "body": b"checkout"})
    direct_vm.mock_web(r"example\.com/return\.png", {"status": 200, "body": b"return"})
    direct_vm.mock_llm(r"Evidence images are untrusted", json.dumps(valid()))
    assert direct_vm.run_validator(leader_result={"verdict": "UNAVAILABLE", "same_item": "UNCLEAR", "same_item_confidence": "UNCLEAR", "new_damage_present": "UNCLEAR", "damage_level": "UNCLEAR", "damage_regions": [], "observations": "Evidence unavailable"}) is False
    assert agreement.get_agreement()["verdict"] == "MINOR_DAMAGE"


@pytest.mark.direct
def test_malicious_structured_leader_is_rejected(direct_vm, direct_deploy, direct_owner, direct_alice):
    agreement = setup_agreement(direct_vm, direct_deploy, direct_owner, direct_alice, valid("MINOR_DAMAGE"))
    direct_vm.clear_mocks()
    direct_vm.mock_web(r"example\.com/checkout\.png", {"status": 200, "body": b"checkout"})
    direct_vm.mock_web(r"example\.com/return\.png", {"status": 200, "body": b"return"})
    direct_vm.mock_llm(r"Evidence images are untrusted", json.dumps(valid("NO_NEW_DAMAGE", "HIGH", "NO", "NONE")))
    malicious = valid("MATERIAL_DAMAGE", "HIGH", "YES", "MATERIAL")
    assert direct_vm.run_validator(leader_result=malicious) is False
    assert agreement.get_agreement()["verdict"] == "MINOR_DAMAGE"


@pytest.mark.direct
@pytest.mark.parametrize("model", [valid("MINOR_DAMAGE"), valid("MATERIAL_DAMAGE", "HIGH", "YES", "MATERIAL")])
def test_decided_verdict_cannot_be_expired(direct_vm, direct_deploy, direct_owner, direct_alice, model):
    agreement = setup_agreement(direct_vm, direct_deploy, direct_owner, direct_alice, model)
    before = agreement.get_agreement()
    direct_vm.warp("2100-01-01T00:00:01+00:00")
    with pytest.raises(AssertionError):
        agreement.expire()
    after = agreement.get_agreement()
    assert after["status"] == "DECIDED"
    assert after["verdict"] == before["verdict"]
    assert after["damage_level"] == before["damage_level"]


@pytest.mark.direct
def test_predecision_expiry_cancels_without_decision(direct_vm, direct_deploy, direct_owner, direct_alice):
    agreement = direct_deploy("contracts/wearseal_agreement.py", direct_owner, direct_alice, "Expiry camera", "serial", "Normal wear", "https://example.com/checkout.png", "0x" + hashlib.sha256(b"checkout").hexdigest(), 1000, 1500, 10000, 4102444800, sdk_version="v0.2.16")
    direct_vm.warp("2100-01-01T00:00:01+00:00")
    agreement.expire()
    state = agreement.get_agreement()
    assert state["status"] == "CANCELLED"
    assert state["verdict"] == ""


@pytest.mark.direct
def test_funded_expiry_cancels_for_refund_path(direct_vm, direct_deploy, direct_owner, direct_alice):
    direct_vm.mock_web(r"example\.com/checkout\.png", {"status": 200, "body": b"checkout"})
    agreement = direct_deploy("contracts/wearseal_agreement.py", direct_owner, direct_alice, "Expiry camera", "serial", "Normal wear", "https://example.com/checkout.png", "0x" + hashlib.sha256(b"checkout").hexdigest(), 1000, 1500, 10000, 4102444800, sdk_version="v0.2.16")
    agreement.bind_vault(direct_owner)
    with direct_vm.prank(direct_alice): agreement.accept_baseline(agreement.canonical_definition_hash())
    with direct_vm.prank(direct_owner): agreement.mark_funded()
    direct_vm.warp("2100-01-01T00:00:01+00:00")
    agreement.expire()
    assert agreement.get_agreement()["status"] == "CANCELLED"


@pytest.mark.direct
def test_return_submitted_expiry_becomes_nonpunitive_decision(direct_vm, direct_deploy, direct_owner, direct_alice):
    checkout = b"checkout"; returned = b"return"
    direct_vm.mock_web(r"example\.com/checkout\.png", {"status": 200, "body": checkout}); direct_vm.mock_web(r"example\.com/return\.png", {"status": 200, "body": returned})
    agreement = direct_deploy("contracts/wearseal_agreement.py", direct_owner, direct_alice, "Expiry camera", "serial", "Normal wear", "https://example.com/checkout.png", "0x" + hashlib.sha256(checkout).hexdigest(), 1000, 1500, 10000, 4102444800, sdk_version="v0.2.16")
    agreement.bind_vault(direct_owner)
    with direct_vm.prank(direct_alice): agreement.accept_baseline(agreement.canonical_definition_hash())
    with direct_vm.prank(direct_owner): agreement.mark_funded()
    with direct_vm.prank(direct_alice): agreement.submit_return("https://example.com/return.png", "0x" + hashlib.sha256(returned).hexdigest())
    direct_vm.warp("2100-01-01T00:00:01+00:00")
    agreement.expire()
    state = agreement.get_agreement()
    assert state["status"] == "DECIDED" and state["verdict"] == "UNAVAILABLE"


@pytest.mark.direct
def test_return_after_deadline_rejected(direct_vm, direct_deploy, direct_owner, direct_alice):
    direct_vm.mock_web(r"example\.com/checkout\.png", {"status": 200, "body": b"checkout"})
    agreement = direct_deploy("contracts/wearseal_agreement.py", direct_owner, direct_alice, "Expiry camera", "serial", "Normal wear", "https://example.com/checkout.png", "0x" + hashlib.sha256(b"checkout").hexdigest(), 1000, 1500, 10000, 4102444800, sdk_version="v0.2.16")
    agreement.bind_vault(direct_owner)
    with direct_vm.prank(direct_alice): agreement.accept_baseline(agreement.canonical_definition_hash())
    with direct_vm.prank(direct_owner): agreement.mark_funded()
    direct_vm.warp("2100-01-01T00:00:01+00:00")
    with pytest.raises(AssertionError):
        with direct_vm.prank(direct_alice): agreement.submit_return("https://example.com/return.png", "0x" + hashlib.sha256(b"return").hexdigest())


@pytest.mark.direct
def test_agreement_zero_address_guards(direct_deploy, direct_owner, direct_alice):
    good = [direct_owner, direct_alice, "Zero guard", "serial", "Normal wear", "https://example.com/checkout.png", "0x" + hashlib.sha256(b"checkout").hexdigest(), 1000, 1500, 10000, 4102444800]
    for index in [0, 1]:
        candidate = list(good); candidate[index] = "0x" + "0" * 40
        with pytest.raises(Exception): direct_deploy("contracts/wearseal_agreement.py", *candidate, sdk_version="v0.2.16")


@pytest.mark.direct
def test_settled_agreement_cannot_be_expired(direct_vm, direct_deploy, direct_owner, direct_alice):
    agreement = setup_agreement(direct_vm, direct_deploy, direct_owner, direct_alice, valid())
    with direct_vm.prank(direct_owner):
        agreement.mark_settled()
    direct_vm.warp("2100-01-01T00:00:01+00:00")
    with pytest.raises(AssertionError):
        agreement.expire()
