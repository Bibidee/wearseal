# v0.3.0
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *

@gl.contract_interface
class Agreement:
    class View:
        def get_agreement(self)->dict: ...
        def settlement_instruction(self)->dict: ...
    class Write:
        def mark_funded(self)->None: ...
        def mark_settled(self)->None: ...

ZERO = "0x0000000000000000000000000000000000000000"

def valid_tx_hash(value):
    return isinstance(value, str) and len(value) == 66 and value[:2].lower() == "0x" and all(c in "0123456789abcdefABCDEF" for c in value[2:])

class WearsealVault(gl.Contract):
    """Studionet accounting mirror for the external Base Sepolia escrow.

    This contract deliberately never accepts native value and never emits an
    asynchronous payout message. Base Sepolia owns the deposit and performs
    winner pull-claims atomically. These methods record finalized external
    transactions after the caller has verified them.
    """
    agreement_contract:Address
    attestor:Address
    credited:u256
    settled:bool
    owner_claim:u256
    renter_claim:u256
    owner_claimed:bool
    renter_claimed:bool
    funding_tx:str
    owner_claim_tx:str
    renter_claim_tx:str

    def __init__(self, agreement_contract, attestor):
        address = agreement_contract if not isinstance(agreement_contract, (bytes, bytearray, str)) else Address(agreement_contract)
        attestor_address = attestor if not isinstance(attestor, (bytes, bytearray, str)) else Address(attestor)
        assert str(address).lower() != ZERO and str(attestor_address).lower() != ZERO
        self.agreement_contract = address; self.attestor = attestor_address; self.credited = u256(0); self.settled = False
        self.owner_claim = u256(0); self.renter_claim = u256(0)
        self.owner_claimed = False; self.renter_claimed = False
        self.funding_tx = ""; self.owner_claim_tx = ""; self.renter_claim_tx = ""

    @gl.public.write
    def deposit(self, amount, funding_tx):
        assert gl.message.value == 0 and gl.message.sender_address == self.attestor and self.credited == 0 and not self.settled and int(amount) > 0 and valid_tx_hash(funding_tx)
        a = Agreement(self.agreement_contract).view().get_agreement()
        assert int(amount) == int(a["deposit"]) and a["status"] == "BASELINE_ACCEPTED"
        self.credited = u256(amount); self.funding_tx = funding_tx
        Agreement(self.agreement_contract).emit(on="finalized").mark_funded()

    @gl.public.write
    def sync_funding(self):
        a = Agreement(self.agreement_contract).view().get_agreement()
        assert self.credited > 0 and not self.settled and a["status"] == "BASELINE_ACCEPTED"
        Agreement(self.agreement_contract).emit(on="finalized").mark_funded()

    @gl.public.view
    def get_vault(self) -> dict:
        return {"agreement": self.agreement_contract, "attestor": self.attestor, "credited": self.credited, "settled": self.settled, "owner_claim": self.owner_claim, "renter_claim": self.renter_claim, "owner_claimed": self.owner_claimed, "renter_claimed": self.renter_claimed, "funding_tx": self.funding_tx, "owner_claim_tx": self.owner_claim_tx, "renter_claim_tx": self.renter_claim_tx, "payout_mode": "BASE_SEPOLIA_PULL_ESCROW"}

    @gl.public.write
    def settle(self):
        assert self.credited > 0 and not self.settled
        a = Agreement(self.agreement_contract).view().settlement_instruction(); assert a["terminal"] and 0 <= a["owner_bps"] <= 10000
        self.settled = True; owner_amount = self.credited * a["owner_bps"] // 10000; renter_amount = self.credited - owner_amount
        self.owner_claim = owner_amount; self.renter_claim = renter_amount; self.credited = u256(0)
        Agreement(self.agreement_contract).emit(on="finalized").mark_settled()

    @gl.public.write
    def sync_settlement(self):
        a = Agreement(self.agreement_contract).view().get_agreement(); assert self.settled and a["status"] == "DECIDED"
        Agreement(self.agreement_contract).emit(on="finalized").mark_settled()

    @gl.public.write
    def ack_owner_claim(self, payout_tx):
        assert self.settled and gl.message.sender_address == self.attestor and self.owner_claim > 0 and not self.owner_claimed and valid_tx_hash(payout_tx)
        self.owner_claimed = True; self.owner_claim_tx = payout_tx

    @gl.public.write
    def ack_renter_claim(self, payout_tx):
        assert self.settled and gl.message.sender_address == self.attestor and self.renter_claim > 0 and not self.renter_claimed and valid_tx_hash(payout_tx)
        self.renter_claimed = True; self.renter_claim_tx = payout_tx

    @gl.public.write
    def refund_cancelled(self, payout_tx):
        assert self.credited > 0 and not self.settled and gl.message.sender_address == self.attestor and valid_tx_hash(payout_tx)
        a = Agreement(self.agreement_contract).view().get_agreement(); assert a["status"] == "CANCELLED"
        amount = self.credited; self.settled = True; self.credited = u256(0); self.renter_claim = amount; self.renter_claimed = True; self.renter_claim_tx = payout_tx
