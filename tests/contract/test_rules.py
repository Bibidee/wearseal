from pathlib import Path
import re

ROOT=Path(__file__).parents[2]
AGREEMENT=(ROOT/'contracts'/'wearseal_agreement.py').read_text()
VAULT=(ROOT/'contracts'/'wearseal_vault.py').read_text()

def test_studionet_and_stable_runtime_markers():
    assert 'py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6' in AGREEMENT
    assert 'gl.vm.run_nondet_unsafe' in AGREEMENT

def test_verdicts_and_fail_safe_policy_are_present():
    for verdict in ['NO_NEW_DAMAGE','NORMAL_WEAR','MINOR_DAMAGE','MATERIAL_DAMAGE','INCONCLUSIVE','UNAVAILABLE']:
        assert verdict in AGREEMENT
    assert 'LOW","UNCLEAR' in AGREEMENT or 'LOW","UNCLEAR' in AGREEMENT
    assert 'owner_bps = 0' in AGREEMENT

def test_vault_replay_and_exact_accounting_guards():
    assert 'not self.settled.get(agreement_id,False)' in VAULT
    assert 'gl.message.value == agreement["deposit"]' in VAULT
    assert 'owner_amount = amount * a["owner_bps"] // 10000' in VAULT

def test_url_and_hash_bounds():
    assert 'url.startswith("https://")' in AGREEMENT
    assert 'len(content_hash) == 64' in AGREEMENT
