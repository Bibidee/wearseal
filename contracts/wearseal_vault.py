# v0.2.18
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *
class WearsealVault(gl.Contract):
    def __init__(self,agreement_contract): self.agreement_contract=agreement_contract;self.credited=0;self.settled=False
    @gl.public.write
    def deposit(self):
        assert self.credited==0 and gl.message.value>0
        a=gl.contract.call(self.agreement_contract,"get_agreement");assert gl.message.sender_address==a["renter"] and gl.message.value==a["deposit"] and a["status"]=="BASELINE_ACCEPTED"
        self.credited=gl.message.value;gl.contract.call(self.agreement_contract,"mark_funded")
    @gl.public.view
    def get_vault(self): return {"agreement":self.agreement_contract,"credited":self.credited,"settled":self.settled}
    @gl.public.write
    def settle(self):
        assert self.credited>0 and not self.settled
        a=gl.contract.call(self.agreement_contract,"settlement_instruction");assert a["terminal"]
        self.settled=True;gl.contract.call(self.agreement_contract,"mark_settled")
        owner_amount=self.credited*a["owner_bps"]//10000;renter_amount=self.credited-owner_amount
        gl.message.send(a["owner"],owner_amount);gl.message.send(a["renter"],renter_amount)
    @gl.public.write
    def refund_cancelled(self):
        assert self.credited>0 and not self.settled
        a=gl.contract.call(self.agreement_contract,"get_agreement");assert a["status"]=="CANCELLED"
        self.settled=True;gl.message.send(a["renter"],self.credited)
