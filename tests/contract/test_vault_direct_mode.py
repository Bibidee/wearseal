import os
import sys
import pytest
from pathlib import Path
from gltest.direct.sdk_loader import setup_sdk_paths
setup_sdk_paths(Path("contracts/wearseal_vault.py"), version=os.environ.get("GENVM_DIRECT_VERSION", "v0.2.16"))
from genlayer import Address

ZERO = "0x" + "0" * 40
DEPOSIT = 1000

@pytest.fixture(autouse=True)
def windows_tempfile_workaround(monkeypatch):
    original_unlink = os.unlink
    def safe_unlink(path, *args, **kwargs):
        try: original_unlink(path, *args, **kwargs)
        except PermissionError: pass
    monkeypatch.setattr(os, "unlink", safe_unlink)

@pytest.fixture
def vault_harness(direct_vm, direct_deploy, direct_owner, direct_alice, monkeypatch):
    state = {"owner": direct_owner, "renter": direct_alice, "status": "BASELINE_ACCEPTED", "owner_bps": 1500, "allow_mark": True}
    transfers = []
    class Agreement:
        def __init__(self, _address): pass
        def view(self): return self
        def emit(self, on=None): return self
        def get_agreement(self): return {"owner": module.Address(state["owner"]), "renter": module.Address(state["renter"]), "deposit": DEPOSIT, "status": state["status"]}
        def settlement_instruction(self): assert state["status"] == "DECIDED"; return {"owner": module.Address(state["owner"]), "renter": module.Address(state["renter"]), "deposit": DEPOSIT, "owner_bps": state["owner_bps"], "renter_bps": 10000 - state["owner_bps"], "terminal": True}
        def mark_funded(self):
            if state["allow_mark"]: state["status"] = "FUNDED"
        def mark_settled(self):
            if state["allow_mark"]: state["status"] = "SETTLED"
    class Recipient:
        def __init__(self, address): self.address = address
        def emit_transfer(self, value): transfers.append((self.address, int(value)))
    vault = direct_deploy("contracts/wearseal_vault.py", "0x" + direct_owner.hex(), sdk_version="v0.2.16")
    module = sys.modules["_contract_wearseal_vault"]
    monkeypatch.setattr(module, "Agreement", Agreement); monkeypatch.setattr(module, "Recipient", Recipient)
    return vault, state, transfers

def deposit(vault, direct_vm, renter, amount=DEPOSIT):
    direct_vm.value = amount
    with direct_vm.prank(renter): vault.deposit()
    direct_vm.value = 0

def settle(vault, state, direct_vm, owner_bps=1500):
    state["status"] = "DECIDED"; state["owner_bps"] = owner_bps
    with direct_vm.prank(state["owner"]): vault.settle()

@pytest.mark.direct
def test_vault_constructor_rejects_zero_agreement(direct_deploy):
    with pytest.raises(Exception): direct_deploy("contracts/wearseal_vault.py", ZERO, sdk_version="v0.2.16")

@pytest.mark.direct
def test_vault_direct_deploy_and_readback(vault_harness):
    assert vault_harness[0].get_vault()["credited"] == 0

@pytest.mark.direct
def test_deposit_authorization_amount_and_duplicate(vault_harness, direct_vm, direct_owner, direct_alice):
    vault, _, _ = vault_harness
    with pytest.raises(AssertionError): deposit(vault, direct_vm, direct_owner)
    with pytest.raises(AssertionError): deposit(vault, direct_vm, direct_alice, DEPOSIT - 1)
    deposit(vault, direct_vm, direct_alice)
    with pytest.raises(AssertionError): deposit(vault, direct_vm, direct_alice)

@pytest.mark.direct
def test_deposit_requires_baseline(vault_harness, direct_vm, direct_alice):
    vault, state, _ = vault_harness; state["status"] = "DRAFT"
    with pytest.raises(AssertionError): deposit(vault, direct_vm, direct_alice)

@pytest.mark.direct
def test_funding_child_and_sync_recovery(vault_harness, direct_vm, direct_alice):
    vault, state, _ = vault_harness; state["allow_mark"] = False; deposit(vault, direct_vm, direct_alice); assert state["status"] == "BASELINE_ACCEPTED"; state["allow_mark"] = True; vault.sync_funding(); assert state["status"] == "FUNDED"

@pytest.mark.direct
@pytest.mark.parametrize("owner_bps", [0, 1500, 10000])
def test_settlement_allocations_and_conservation(vault_harness, direct_vm, direct_alice, owner_bps):
    vault, state, _ = vault_harness; deposit(vault, direct_vm, direct_alice); settle(vault, state, direct_vm, owner_bps); result = vault.get_vault(); assert int(result["owner_claim"]) + int(result["renter_claim"]) == DEPOSIT; assert result["credited"] == 0

@pytest.mark.direct
def test_settlement_before_decided_repeat_and_invalid_verdict(vault_harness, direct_vm, direct_alice):
    vault, state, _ = vault_harness; deposit(vault, direct_vm, direct_alice)
    with pytest.raises(AssertionError): vault.settle()
    state["status"] = "DECIDED"; state["owner_bps"] = 99999
    with pytest.raises(AssertionError): vault.settle()
    state["owner_bps"] = 1500; settle(vault, state, direct_vm)
    with pytest.raises(AssertionError): vault.settle()

@pytest.mark.direct
def test_claim_authorization_duplicate_and_transfer_success(vault_harness, direct_vm, direct_owner, direct_alice):
    vault, state, transfers = vault_harness; deposit(vault, direct_vm, direct_alice); settle(vault, state, direct_vm)
    with pytest.raises(AssertionError):
        with direct_vm.prank(direct_alice): vault.claim_owner()
    with direct_vm.prank(direct_owner): vault.claim_owner()
    with pytest.raises(AssertionError):
        with direct_vm.prank(direct_owner): vault.claim_owner()
    with pytest.raises(AssertionError):
        with direct_vm.prank(direct_owner): vault.claim_renter()
    with direct_vm.prank(direct_alice): vault.claim_renter()
    with pytest.raises(AssertionError):
        with direct_vm.prank(direct_alice): vault.claim_renter()
    assert [int(value) for _, value in transfers] == [150, 850]

@pytest.mark.direct
def test_cancelled_refund_and_duplicate_guard(vault_harness, direct_vm, direct_alice):
    vault, state, _ = vault_harness; deposit(vault, direct_vm, direct_alice); state["status"] = "CANCELLED"
    with direct_vm.prank(direct_alice): vault.refund_cancelled()
    result = vault.get_vault(); assert result["settled"] is True and result["credited"] == 0 and result["renter_claim"] == DEPOSIT
    with pytest.raises(AssertionError):
        with direct_vm.prank(direct_alice): vault.refund_cancelled()

@pytest.mark.direct
def test_settlement_sync_recovery(vault_harness, direct_vm, direct_alice):
    vault, state, _ = vault_harness; deposit(vault, direct_vm, direct_alice); state["allow_mark"] = False; settle(vault, state, direct_vm); assert state["status"] == "DECIDED"; state["allow_mark"] = True; vault.sync_settlement(); assert state["status"] == "SETTLED"
