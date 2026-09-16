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
    def __init__(self,agreement_contract): self.agreement_contract=Address(str(agreement_contract));self.credited=u256(0);self.settled=False
    @gl.public.write.payable
    def deposit(self):
        assert self.credited==0 and gl.message.value>0
        a=Agreement(self.agreement_contract).view().get_agreement();assert gl.message.sender_address==a["renter"] and gl.message.value==a["deposit"] and a["status"]=="BASELINE_ACCEPTED"
        self.credited=gl.message.value;Agreement(self.agreement_contract).emit(on="finalized").mark_funded()
    @gl.public.view
    def get_vault(self): return {"agreement":self.agreement_contract,"credited":self.credited,"settled":self.settled}
    @gl.public.write
    def settle(self):
        assert self.credited>0 and not self.settled
        a=Agreement(self.agreement_contract).view().settlement_instruction();assert a["terminal"]
        self.settled=True;owner_amount=self.credited*a["owner_bps"]//10000;renter_amount=self.credited-owner_amount;self.credited=u256(0);Agreement(self.agreement_contract).emit(on="finalized").mark_settled()
        Recipient(a["owner"]).emit_transfer(value=owner_amount);Recipient(a["renter"]).emit_transfer(value=renter_amount)
    @gl.public.write
    def refund_cancelled(self):
        assert self.credited>0 and not self.settled
        a=Agreement(self.agreement_contract).view().get_agreement();assert a["status"]=="CANCELLED"
        amount=self.credited;self.settled=True;self.credited=u256(0);Recipient(a["renter"]).emit_transfer(value=amount)
