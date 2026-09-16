# v0.2.18
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
@gl.evm.contract_interface
class Recipient:
    class View: pass
    class Write: pass
class WearsealVault(gl.Contract):
    agreement_contract:Address
    credited:u256
    settled:bool
    owner_claim:u256
    renter_claim:u256
    owner_claimed:bool
    renter_claimed:bool
    def __init__(self,agreement_contract): self.agreement_contract=Address(str(agreement_contract));self.credited=u256(0);self.settled=False;self.owner_claim=u256(0);self.renter_claim=u256(0);self.owner_claimed=False;self.renter_claimed=False
    @gl.public.write.payable
    def deposit(self):
        assert self.credited==0 and gl.message.value>0
        a=Agreement(self.agreement_contract).view().get_agreement();assert gl.message.sender_address==a["renter"] and gl.message.value==a["deposit"] and a["status"]=="BASELINE_ACCEPTED"
        self.credited=gl.message.value;Agreement(self.agreement_contract).emit(on="finalized").mark_funded()
    @gl.public.view
    def get_vault(self): return {"agreement":self.agreement_contract,"credited":self.credited,"settled":self.settled,"owner_claim":self.owner_claim,"renter_claim":self.renter_claim,"owner_claimed":self.owner_claimed,"renter_claimed":self.renter_claimed}
    @gl.public.write
    def settle(self):
        assert self.credited>0 and not self.settled
        a=Agreement(self.agreement_contract).view().settlement_instruction();assert a["terminal"]
        self.settled=True;owner_amount=self.credited*a["owner_bps"]//10000;renter_amount=self.credited-owner_amount;self.owner_claim=owner_amount;self.renter_claim=renter_amount;self.credited=u256(0);Agreement(self.agreement_contract).emit(on="finalized").mark_settled()
    @gl.public.write
    def claim_owner(self):
        a=Agreement(self.agreement_contract).view().get_agreement();assert self.settled and gl.message.sender_address==a["owner"] and self.owner_claim>0 and not self.owner_claimed
        self.owner_claimed=True;Recipient(a["owner"]).emit_transfer(value=self.owner_claim)
    @gl.public.write
    def claim_renter(self):
        a=Agreement(self.agreement_contract).view().get_agreement();assert self.settled and gl.message.sender_address==a["renter"] and self.renter_claim>0 and not self.renter_claimed
        self.renter_claimed=True;Recipient(a["renter"]).emit_transfer(value=self.renter_claim)
    @gl.public.write
    def refund_cancelled(self):
        assert self.credited>0 and not self.settled
        a=Agreement(self.agreement_contract).view().get_agreement();assert a["status"]=="CANCELLED"
        amount=self.credited;self.settled=True;self.credited=u256(0);self.renter_claim=amount
