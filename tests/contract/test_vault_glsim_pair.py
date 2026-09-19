import hashlib
import os
import pytest

from glsim.engine import SimEngine
from glsim.state import StateStore
from gltest.direct.loader import create_address


@pytest.fixture(autouse=True)
def windows_tempfile_workaround(monkeypatch):
    original_unlink = os.unlink

    def safe_unlink(path, *args, **kwargs):
        try:
            original_unlink(path, *args, **kwargs)
        except PermissionError:
            pass

    monkeypatch.setattr(os, "unlink", safe_unlink)


@pytest.fixture
def pair_engine():
    engine = SimEngine(StateStore(chain_id=61999, seed="wearseal-vault-pair"))
    engine.activate()
    try:
        owner = create_address("pair-owner")
        renter = create_address("pair-renter")
        owner_hex = "0x" + bytes(owner).hex()
        renter_hex = "0x" + bytes(renter).hex()
        checkout = b"pair-checkout"
        checkout_hash = "0x" + hashlib.sha256(checkout).hexdigest()
        engine.vm.mock_web("checkout", {"method": "GET", "status": 200, "body": checkout})
        agreement_address, agreement = engine.deploy(
            "contracts/wearseal_agreement.py",
            [owner_hex, renter_hex, "Pair item", "pair-serial", "Normal wear", "https://example.com/checkout", checkout_hash, 1000, 1500, 10000, 4102444800],
            sender=owner_hex,
        )
        vault_address, vault = engine.deploy("contracts/wearseal_vault.py", [agreement_address], sender=owner_hex)
        engine.call_method(agreement_address, "bind_vault", [vault_address], sender=owner_hex)
        engine.vm.sender = renter
        definition = agreement.canonical_definition_hash()
        engine.call_method(agreement_address, "accept_baseline", [definition], sender=renter_hex)
        yield engine, agreement_address, vault_address, owner_hex, renter_hex
    finally:
        engine.deactivate()


@pytest.mark.direct
def test_real_agreement_and_vault_pair_deploys_and_binds(pair_engine):
    engine, agreement_address, vault_address, _, _ = pair_engine
    agreement = engine.state.get_contract(agreement_address).instance
    vault = engine.state.get_contract(vault_address).instance
    assert str(agreement.get_agreement()["vault"]).lower() == vault_address.lower()
    assert str(vault.get_vault()["agreement"]).lower() == agreement_address.lower()


@pytest.mark.direct
def test_real_pair_deposit_and_funding_message(pair_engine):
    engine, agreement_address, vault_address, _, renter = pair_engine
    engine.vm.value = 1000
    engine.call_method(vault_address, "deposit", sender=renter)
    engine.vm.value = 0
    agreement = engine.state.get_contract(agreement_address).instance
    vault = engine.state.get_contract(vault_address).instance
    assert vault.get_vault()["credited"] == 1000
    assert agreement.get_agreement()["status"] == "FUNDED"


@pytest.mark.direct
def test_real_pair_deposit_guards_and_sync_funding(pair_engine):
    engine, agreement_address, vault_address, owner, renter = pair_engine
    agreement = engine.state.get_contract(agreement_address).instance
    agreement.status = "DRAFT"
    engine.vm.value = 1000
    with pytest.raises(Exception):
        engine.call_method(vault_address, "deposit", sender=renter)
    agreement.status = "BASELINE_ACCEPTED"
    with pytest.raises(Exception):
        engine.call_method(vault_address, "deposit", sender=owner)
    engine.vm.value = 999
    with pytest.raises(Exception):
        engine.call_method(vault_address, "deposit", sender=renter)
    engine.vm.value = 1000
    engine.call_method(vault_address, "deposit", sender=renter)
    engine.vm.value = 0
    assert agreement.get_agreement()["status"] == "FUNDED"
    with pytest.raises(Exception):
        engine.call_method(vault_address, "deposit", sender=renter)
    agreement.status = "BASELINE_ACCEPTED"
    engine.call_method(vault_address, "sync_funding", sender=owner)
    assert agreement.get_agreement()["status"] == "FUNDED"


@pytest.mark.direct
@pytest.mark.parametrize("verdict,expected_bps", [
    ("NO_NEW_DAMAGE", 0),
    ("NORMAL_WEAR", 0),
    ("MINOR_DAMAGE", 1500),
    ("MATERIAL_DAMAGE", 10000),
    ("INCONCLUSIVE", 0),
    ("UNAVAILABLE", 0),
])
def test_real_pair_settlement_uses_authoritative_agreement(verdict, expected_bps, pair_engine):
    engine, agreement_address, vault_address, owner, renter = pair_engine
    engine.vm.value = 1000
    engine.call_method(vault_address, "deposit", sender=renter)
    engine.vm.value = 0
    agreement = engine.state.get_contract(agreement_address).instance
    agreement.status = "DECIDED"
    agreement.verdict = verdict
    engine.call_method(vault_address, "settle", sender=owner)
    vault = engine.state.get_contract(vault_address).instance
    result = vault.get_vault()
    assert result["settled"] is True
    assert int(result["owner_claim"]) == expected_bps * 1000 // 10000
    assert int(result["owner_claim"]) + int(result["renter_claim"]) == 1000
    assert agreement.get_agreement()["status"] == "SETTLED"


@pytest.mark.direct
def test_real_pair_claim_authorization_and_replay_guard(pair_engine):
    engine, agreement_address, vault_address, owner, renter = pair_engine
    engine.vm.value = 1000
    engine.call_method(vault_address, "deposit", sender=renter)
    engine.vm.value = 0
    agreement = engine.state.get_contract(agreement_address).instance
    agreement.status = "DECIDED"
    agreement.verdict = "MINOR_DAMAGE"
    engine.call_method(vault_address, "settle", sender=owner)
    vault = engine.state.get_contract(vault_address).instance
    with pytest.raises(Exception):
        engine.call_method(vault_address, "claim_owner", sender=renter)
    with pytest.raises(Exception):
        engine.call_method(vault_address, "claim_renter", sender=owner)
    assert vault.get_vault()["owner_claimed"] is False
    assert vault.get_vault()["renter_claimed"] is False


@pytest.mark.direct
def test_glsim_documents_unavailable_evm_payout_boundary(pair_engine):
    engine, agreement_address, vault_address, owner, renter = pair_engine
    engine.vm.value = 1000
    engine.call_method(vault_address, "deposit", sender=renter)
    engine.vm.value = 0
    agreement = engine.state.get_contract(agreement_address).instance
    agreement.status = "DECIDED"
    agreement.verdict = "MINOR_DAMAGE"
    engine.call_method(vault_address, "settle", sender=owner)
    vault = engine.state.get_contract(vault_address).instance
    engine.call_method(vault_address, "claim_owner", sender=owner)
    # glsim has no EVM recipient implementation; this is not payout success
    # evidence and exposes why the live child-receipt boundary remains open.
    assert vault.get_vault()["owner_claimed"] is True


@pytest.mark.direct
def test_real_pair_cancelled_refund_and_duplicate_guard(pair_engine):
    engine, agreement_address, vault_address, _, renter = pair_engine
    engine.vm.value = 1000
    engine.call_method(vault_address, "deposit", sender=renter)
    engine.vm.value = 0
    agreement = engine.state.get_contract(agreement_address).instance
    agreement.status = "CANCELLED"
    engine.call_method(vault_address, "refund_cancelled", sender=renter)
    vault = engine.state.get_contract(vault_address).instance
    result = vault.get_vault()
    assert result["settled"] is True and result["credited"] == 0 and result["renter_claim"] == 1000
    with pytest.raises(Exception):
        engine.call_method(vault_address, "refund_cancelled", sender=renter)


@pytest.mark.direct
def test_real_pair_invalid_verdict_and_repeat_settlement_guards(pair_engine):
    engine, agreement_address, vault_address, owner, renter = pair_engine
    engine.vm.value = 1000
    engine.call_method(vault_address, "deposit", sender=renter)
    engine.vm.value = 0
    agreement = engine.state.get_contract(agreement_address).instance
    agreement.status = "DECIDED"
    agreement.verdict = "CORRUPTED"
    with pytest.raises(Exception):
        engine.call_method(vault_address, "settle", sender=owner)
    assert engine.state.get_contract(vault_address).instance.get_vault()["credited"] == 1000
    agreement.verdict = "NO_NEW_DAMAGE"
    engine.call_method(vault_address, "settle", sender=owner)
    with pytest.raises(Exception):
        engine.call_method(vault_address, "settle", sender=owner)
    assert engine.state.get_contract(vault_address).instance.get_vault()["settled"] is True
