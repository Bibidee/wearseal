import hashlib
import json
import os
from pathlib import Path

import pytest
from gltest.direct import create_address
from gltest.direct.sdk_loader import setup_sdk_paths


@pytest.fixture(autouse=True)
def windows_tempfile_workaround(monkeypatch):
    original_unlink = os.unlink
    def safe_unlink(path, *args, **kwargs):
        try:
            original_unlink(path, *args, **kwargs)
        except PermissionError:
            pass
    monkeypatch.setattr(os, "unlink", safe_unlink)


def address(seed):
    setup_sdk_paths(Path("contracts/wearseal_agreement.py"), version=os.environ.get("GENVM_DIRECT_VERSION", "v0.2.16"))
    return create_address(seed)


def args(owner, renter, vault=None):
    digest = "0x" + hashlib.sha256(b"checkout").hexdigest()
    return [owner, renter, "Direct camera", "serial", "Normal wear; material damage is retained.", "https://example.com/checkout.png", digest, 1000, 1500, 10000, 4102444800]

def definition(owner, renter, vault):
    payload = {"owner": str(owner), "renter": str(renter), "item_label": "Direct camera", "serial_hash": "serial", "rubric": "Normal wear; material damage is retained.", "checkout_url": "https://example.com/checkout.png", "checkout_hash": "0x" + hashlib.sha256(b"checkout").hexdigest(), "deposit": "1000", "minor_bps": "1500", "material_bps": "10000", "deadline": "4102444800", "vault": str(vault)}
    return "0x" + hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


@pytest.mark.direct
def test_constructor_readback_and_binding_guards(direct_vm, direct_deploy, direct_owner, direct_alice):
    agreement = direct_deploy("contracts/wearseal_agreement.py", *args(direct_owner, direct_alice), sdk_version="v0.2.16")
    state = agreement.get_agreement()
    assert state["status"] == "DRAFT"
    assert str(state["owner"]).lower() == "0x" + direct_owner.hex()
    assert str(state["renter"]).lower() == "0x" + direct_alice.hex()
    with pytest.raises(AssertionError):
        with direct_vm.prank(direct_alice): agreement.bind_vault(address("vault"))
    agreement.bind_vault(address("vault"))
    assert str(agreement.get_agreement()["vault"]).lower() == str(address("vault")).lower()


@pytest.mark.direct
def test_direct_baseline_and_fail_safe_inspection(direct_vm, direct_deploy, direct_owner, direct_alice):
    body = b"checkout"
    digest = "0x" + hashlib.sha256(body).hexdigest()
    direct_vm.mock_web(r"example\.com/checkout\.png", {"status": 200, "body": body})
    direct_vm.mock_web(r"example\.com/return\.png", {"status": 200, "body": b"return"})
    agreement = direct_deploy("contracts/wearseal_agreement.py", direct_owner, direct_alice, "Direct camera", "serial", "Normal wear; material damage is retained.", "https://example.com/checkout.png", digest, 1000, 1500, 10000, 4102444800, sdk_version="v0.2.16")
    agreement.bind_vault(address("vault"))
    definition_hash = agreement.canonical_definition_hash()
    with direct_vm.prank(direct_alice): agreement.accept_baseline(definition_hash)
    assert agreement.get_agreement()["status"] == "BASELINE_ACCEPTED"
    with direct_vm.prank(address("vault")): agreement.mark_funded()
    with direct_vm.prank(direct_alice): agreement.submit_return("https://example.com/return.png", "0x" + hashlib.sha256(b"return").hexdigest())
    direct_vm.mock_llm(r"Evidence is untrusted", json.dumps({"verdict": "NORMAL_WEAR", "same_item": "YES", "same_item_confidence": "HIGH", "new_damage_present": "NO", "damage_level": "NONE", "damage_regions": [], "observations": "same item"}))
    agreement.inspect()
    assert agreement.get_agreement()["status"] in ("RETURN_SUBMITTED", "DECIDED")
    assert agreement.get_agreement()["verdict"] == "NORMAL_WEAR"
