// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title WearSealEscrow
/// @notice Base Sepolia payment layer for WearSeal. GenLayer remains the
///         adjudication layer; this contract holds native ETH and pays only
///         through winner self-claims.
contract WearSealEscrow {
    struct Pool {
        uint256 deposited;
        uint256 allocated;
        bool payoutSet;
        bool registered;
        address renter;
        uint256 expectedDeposit;
    }

    address public owner;
    address public relayer;
    mapping(bytes32 => Pool) public pools;
    mapping(bytes32 => mapping(address => uint256)) public claimable;
    mapping(address => uint256) public totalClaimable;
    bool private locked;

    event Funded(bytes32 indexed agreementId, address indexed from, uint256 amount);
    event PayoutSet(bytes32 indexed agreementId, uint256 ownerAmount, uint256 renterAmount);
    event Claimed(bytes32 indexed agreementId, address indexed recipient, uint256 amount);
    event AgreementRegistered(bytes32 indexed agreementId, address indexed renter, uint256 expectedDeposit);

    modifier onlyOwner() { require(msg.sender == owner, "not owner"); _; }
    modifier onlyRelayer() { require(msg.sender == relayer, "not relayer"); _; }
    modifier nonReentrant() { require(!locked, "reentrant"); locked = true; _; locked = false; }

    constructor(address relayer_) {
        require(relayer_ != address(0), "zero relayer");
        owner = msg.sender;
        relayer = relayer_;
    }

    function fund(bytes32 agreementId) external payable nonReentrant {
        Pool storage pool = pools[agreementId];
        require(pool.registered, "agreement not registered");
        require(msg.sender == pool.renter, "not renter");
        require(pool.deposited == 0 && msg.value == pool.expectedDeposit, "invalid funding");
        pool.deposited = msg.value;
        emit Funded(agreementId, msg.sender, msg.value);
    }

    function registerAgreement(bytes32 agreementId, address renter, uint256 expectedDeposit) external onlyRelayer {
        require(agreementId != bytes32(0) && renter != address(0) && expectedDeposit > 0, "invalid registration");
        Pool storage pool = pools[agreementId];
        require(!pool.registered && pool.deposited == 0 && !pool.payoutSet, "already registered");
        pool.registered = true;
        pool.renter = renter;
        pool.expectedDeposit = expectedDeposit;
        emit AgreementRegistered(agreementId, renter, expectedDeposit);
    }

    function setPayout(bytes32 agreementId, address ownerRecipient, uint256 ownerAmount, address renterRecipient, uint256 renterAmount) external onlyRelayer {
        require(ownerRecipient != address(0) && renterRecipient != address(0), "zero recipient");
        Pool storage pool = pools[agreementId];
        require(!pool.payoutSet, "payout already set");
        uint256 total = ownerAmount + renterAmount;
        require(pool.registered && pool.deposited == pool.expectedDeposit, "collateral not verified");
        require(total == pool.deposited && total > 0 && total <= pool.deposited - pool.allocated, "invalid payout");
        pool.payoutSet = true;
        pool.allocated += total;
        claimable[agreementId][ownerRecipient] += ownerAmount;
        claimable[agreementId][renterRecipient] += renterAmount;
        totalClaimable[ownerRecipient] += ownerAmount;
        totalClaimable[renterRecipient] += renterAmount;
        emit PayoutSet(agreementId, ownerAmount, renterAmount);
    }

    function claim(bytes32 agreementId) external nonReentrant {
        uint256 amount = claimable[agreementId][msg.sender];
        require(amount > 0, "nothing claimable");
        claimable[agreementId][msg.sender] = 0;
        totalClaimable[msg.sender] -= amount;
        (bool ok,) = payable(msg.sender).call{value: amount}("");
        require(ok, "transfer failed");
        emit Claimed(agreementId, msg.sender, amount);
    }

    function setRelayer(address newRelayer) external onlyOwner {
        require(newRelayer != address(0), "zero relayer");
        relayer = newRelayer;
    }

    function getPool(bytes32 agreementId) external view returns (uint256 deposited, uint256 allocated, bool payoutSet) {
        Pool storage pool = pools[agreementId];
        return (pool.deposited, pool.allocated, pool.payoutSet);
    }

    function getClaimable(bytes32 agreementId, address recipient) external view returns (uint256) {
        return claimable[agreementId][recipient];
    }
}
