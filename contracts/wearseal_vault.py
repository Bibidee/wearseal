# v0.2.18
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *

class WearsealVault(gl.Contract):
    def __init__(self, agreement_contract):
        self.agreement_contract = agreement_contract; self.credited = {}; self.settled = {}; self.total_credited = 0
    @gl.public.write
    def deposit(self, agreement_id):
        assert gl.message.value > 0 and agreement_id not in self.credited
        agreement = gl.contract.call(self.agreement_contract, "get_agreement")
        assert gl.message.sender_address == agreement["renter"] and gl.message.value == agreement["deposit"] and agreement["status"] == "BASELINE_ACCEPTED"
        self.credited[agreement_id] = gl.message.value; self.total_credited += gl.message.value
    @gl.public.view
    def get_vault(self, agreement_id): return {"credited":self.credited.get(agreement_id,0),"settled":self.settled.get(agreement_id,False),"total_credited":self.total_credited}
    @gl.public.write
    def settle(self, agreement_id):
        assert not self.settled.get(agreement_id,False) and agreement_id in self.credited
        a = gl.contract.call(self.agreement_contract, "settlement_instruction"); assert a["terminal"]
        amount = self.credited[agreement_id]; owner_amount = amount * a["owner_bps"] // 10000; renter_amount = amount - owner_amount
        self.settled[agreement_id] = True
        gl.message.send(a["owner"], owner_amount); gl.message.send(a["renter"], renter_amount)
    @gl.public.write
    def refund_cancelled(self, agreement_id):
        assert not self.settled.get(agreement_id,False) and agreement_id in self.credited
        a = gl.contract.call(self.agreement_contract, "get_agreement"); assert a["status"] == "CANCELLED"
        self.settled[agreement_id] = True; gl.message.send(a["renter"], self.credited[agreement_id])
