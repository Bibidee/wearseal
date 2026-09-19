import os
import sys
import pytest
from pathlib import Path
from gltest.direct.sdk_loader import setup_sdk_paths
setup_sdk_paths(Path("contracts/wearseal_vault.py"), version=os.environ.get("GENVM_DIRECT_VERSION", "v0.2.16"))

ZERO = "0x" + "0" * 40
DEPOSIT = 1000
TX = "0x" + "1" * 64

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
    class Agreement:
        def __init__(self, _address): pass
        def view(self): return self
        def emit(self, on=None): return self
        def get_agreement(self): return {"owner": module.Address(state["owner"]), "renter": module.Address(state["renter"]), "deposit": DEPOSIT, "status": state["status"]}
        def settlement_instruction(self): assert state["status"] == "DECIDED" and 0 <= state["owner_bps"] <= 10000; return {"owner": module.Address(state["owner"]), "renter": module.Address(state["renter"]), "deposit": DEPOSIT, "owner_bps": state["owner_bps"], "renter_bps": 10000 - state["owner_bps"], "terminal": True}
        def mark_funded(self):
            if state["allow_mark"]: state["status"] = "FUNDED"
        def mark_settled(self):
            if state["allow_mark"]: state["status"] = "SETTLED"
    vault = direct_deploy("contracts/wearseal_vault.py", "0x" + direct_owner.hex(), sdk_version="v0.2.16")
    module = sys.modules["_contract_wearseal_vault"]
    monkeypatch.setattr(module, "Agreement", Agreement)
    return vault, state

def deposit(vault, direct_vm, renter, amount=DEPOSIT, tx=TX):
    direct_vm.value = 0
    with direct_vm.prank(renter): vault.deposit(amount, tx)

def settle(vault, state, direct_vm, owner_bps=1500):
    state["status"] = "DECIDED"; state["owner_bps"] = owner_bps
    with direct_vm.prank(state["owner"]): vault.settle()

@pytest.mark.direct
def test_vault_constructor_rejects_zero_agreement(direct_deploy):
    with pytest.raises(Exception): direct_deploy("contracts/wearseal_vault.py", ZERO, sdk_version="v0.2.16")

@pytest.mark.direct
def test_vault_direct_deploy_and_readback(vault_harness):
    result = vault_harness[0].get_vault(); assert result["credited"] == 0 and result["payout_mode"] == "BASE_SEPOLIA_PULL_ESCROW"

@pytest.mark.direct
def test_deposit_authorization_amount_duplicate_and_zero_value(vault_harness, direct_vm, direct_owner, direct_alice):
    vault, _ = vault_harness
    with pytest.raises(AssertionError):
        with direct_vm.prank(direct_owner): vault.deposit(DEPOSIT, TX)
    with pytest.raises(AssertionError):
        with direct_vm.prank(direct_alice): vault.deposit(DEPOSIT - 1, TX)
    with pytest.raises(AssertionError):
        direct_vm.value = 1
        with direct_vm.prank(direct_alice): vault.deposit(DEPOSIT, TX)
    direct_vm.value = 0; deposit(vault, direct_vm, direct_alice)
    with pytest.raises(AssertionError):
        with direct_vm.prank(direct_alice): vault.deposit(DEPOSIT, TX)

@pytest.mark.direct
def test_deposit_requires_baseline_and_valid_tx(vault_harness, direct_vm, direct_alice):
    vault, state = vault_harness; state["status"] = "DRAFT"
    with pytest.raises(AssertionError):
        with direct_vm.prank(direct_alice): vault.deposit(DEPOSIT, TX)
    state["status"] = "BASELINE_ACCEPTED"
    with pytest.raises(AssertionError):
        with direct_vm.prank(direct_alice): vault.deposit(DEPOSIT, "bad")

@pytest.mark.direct
def test_funding_child_and_sync_recovery(vault_harness, direct_vm, direct_alice):
    vault, state = vault_harness; state["allow_mark"] = False; deposit(vault, direct_vm, direct_alice); assert state["status"] == "BASELINE_ACCEPTED"; state["allow_mark"] = True; vault.sync_funding(); assert state["status"] == "FUNDED"

@pytest.mark.direct
@pytest.mark.parametrize("owner_bps", [0, 1500, 10000])
def test_settlement_allocations_and_conservation(vault_harness, direct_vm, direct_alice, owner_bps):
    vault, state = vault_harness; deposit(vault, direct_vm, direct_alice); settle(vault, state, direct_vm, owner_bps); result = vault.get_vault(); assert int(result["owner_claim"]) + int(result["renter_claim"]) == DEPOSIT and result["credited"] == 0

@pytest.mark.direct
@pytest.mark.parametrize("owner_bps", [0, 1500, 10000])
def test_explicit_allocation_cases(vault_harness, direct_vm, direct_alice, owner_bps):
    vault, state = vault_harness; deposit(vault, direct_vm, direct_alice); settle(vault, state, direct_vm, owner_bps); result = vault.get_vault(); assert int(result["owner_claim"]) == DEPOSIT * owner_bps // 10000

@pytest.mark.direct
def test_settlement_before_decided_repeat_and_invalid_verdict(vault_harness, direct_vm, direct_alice):
    vault, state = vault_harness; deposit(vault, direct_vm, direct_alice)
    with pytest.raises(AssertionError): vault.settle()
    state["status"] = "DECIDED"; state["owner_bps"] = 99999
    with pytest.raises(AssertionError): vault.settle()
    state["owner_bps"] = 1500; settle(vault, state, direct_vm)
    with pytest.raises(AssertionError): vault.settle()

@pytest.mark.direct
def test_claim_authorization_duplicate_and_ack(vault_harness, direct_vm, direct_owner, direct_alice):
    vault, state = vault_harness; deposit(vault, direct_vm, direct_alice); settle(vault, state, direct_vm)
    with pytest.raises(AssertionError):
        with direct_vm.prank(direct_alice): vault.ack_owner_claim(TX)
    with direct_vm.prank(direct_owner): vault.ack_owner_claim(TX)
    with pytest.raises(AssertionError):
        with direct_vm.prank(direct_owner): vault.ack_owner_claim(TX)
    with pytest.raises(AssertionError):
        with direct_vm.prank(direct_owner): vault.ack_renter_claim(TX)
    with direct_vm.prank(direct_alice): vault.ack_renter_claim(TX)
    with pytest.raises(AssertionError):
        with direct_vm.prank(direct_alice): vault.ack_renter_claim(TX)

@pytest.mark.direct
def test_cancelled_refund_and_duplicate_guard(vault_harness, direct_vm, direct_alice):
    vault, state = vault_harness; deposit(vault, direct_vm, direct_alice); state["status"] = "CANCELLED"
    with direct_vm.prank(direct_alice): vault.refund_cancelled(TX)
    result = vault.get_vault(); assert result["settled"] is True and result["credited"] == 0 and result["renter_claim"] == DEPOSIT and result["renter_claimed"] is True
    with pytest.raises(AssertionError):
        with direct_vm.prank(direct_alice): vault.refund_cancelled(TX)

@pytest.mark.direct
def test_settlement_sync_recovery(vault_harness, direct_vm, direct_alice):
    vault, state = vault_harness; deposit(vault, direct_vm, direct_alice); state["allow_mark"] = False; settle(vault, state, direct_vm); assert state["status"] == "DECIDED"; state["allow_mark"] = True; vault.sync_settlement(); assert state["status"] == "SETTLED"

@pytest.mark.direct
def test_claim_failure_boundary_is_not_in_vault(vault_harness, direct_vm, direct_alice):
    vault, state = vault_harness; deposit(vault, direct_vm, direct_alice); settle(vault, state, direct_vm)
    result = vault.get_vault(); assert result["owner_claimed"] is False and result["renter_claimed"] is False
    # EVM transfer failure is tested at the escrow layer; this contract has no
    # child transfer call and therefore cannot mark a failed transfer claimed.
