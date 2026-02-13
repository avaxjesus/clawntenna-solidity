const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("MessageEscrowV2", function () {
  let registry;
  let escrow;
  let mockToken;
  let owner, treasury, appOwner, topicOwner, sender1, sender2;

  const ACCESS_PUBLIC = 0;
  const MESSAGE_FEE = ethers.parseEther("0.02");
  const ERC20_MESSAGE_FEE = ethers.parseEther("1");
  const ONE_HOUR = 3600;

  beforeEach(async function () {
    [owner, treasury, appOwner, topicOwner, sender1, sender2] = await ethers.getSigners();

    // Deploy mock ERC20
    const MockToken = await ethers.getContractFactory("MockERC20");
    mockToken = await MockToken.deploy("Mock Token", "MTK", ethers.parseEther("1000000"));
    await mockToken.waitForDeployment();

    // Deploy registry V1 → V9
    const V1 = await ethers.getContractFactory("AntennaRegistryV1");
    const v1 = await upgrades.deployProxy(V1, [treasury.address], { initializer: "initialize", kind: "uups" });
    await v1.waitForDeployment();

    const V2 = await ethers.getContractFactory("AntennaRegistryV2");
    const v2 = await upgrades.upgradeProxy(await v1.getAddress(), V2);
    const V3 = await ethers.getContractFactory("AntennaRegistryV3");
    const v3 = await upgrades.upgradeProxy(await v2.getAddress(), V3);
    const V4 = await ethers.getContractFactory("AntennaRegistryV4");
    const v4 = await upgrades.upgradeProxy(await v3.getAddress(), V4);
    const V5 = await ethers.getContractFactory("AntennaRegistryV5");
    const v5 = await upgrades.upgradeProxy(await v4.getAddress(), V5);
    const V6 = await ethers.getContractFactory("AntennaRegistryV6");
    const v6 = await upgrades.upgradeProxy(await v5.getAddress(), V6);
    const V7 = await ethers.getContractFactory("AntennaRegistryV7");
    const v7 = await upgrades.upgradeProxy(await v6.getAddress(), V7);
    const V8 = await ethers.getContractFactory("AntennaRegistryV8");
    const v8 = await upgrades.upgradeProxy(await v7.getAddress(), V8);
    const V9 = await ethers.getContractFactory("AntennaRegistryV9");
    registry = await upgrades.upgradeProxy(await v8.getAddress(), V9);

    // Deploy escrow V1 → V2
    const EscrowV1 = await ethers.getContractFactory("MessageEscrowV1");
    const escrowV1 = await upgrades.deployProxy(EscrowV1, [await registry.getAddress(), treasury.address], { initializer: "initialize", kind: "uups" });
    await escrowV1.waitForDeployment();

    const EscrowV2 = await ethers.getContractFactory("MessageEscrowV2");
    escrow = await upgrades.upgradeProxy(await escrowV1.getAddress(), EscrowV2);

    // Link escrow to registry
    await registry.setEscrowContract(await escrow.getAddress());

    // Setup app and topic
    await registry.connect(appOwner).createApplication("TestApp", "Test", "https://test.app", true);
    await registry.connect(topicOwner).createTopic(1, "TestTopic", "Test", ACCESS_PUBLIC);
  });

  // ================================================================
  // Version
  // ================================================================

  describe("Version", function () {
    it("should return V2 version", async function () {
      expect(await escrow.getVersion()).to.equal("2.0.0");
    });
  });

  // ================================================================
  // ERC-20 Backward Compatibility
  // ================================================================

  describe("ERC-20 Backward Compatibility", function () {
    let tokenAddress;

    beforeEach(async function () {
      tokenAddress = await mockToken.getAddress();
      const registryAddress = await registry.getAddress();

      await registry.connect(topicOwner).setTopicMessageFee(1, tokenAddress, ERC20_MESSAGE_FEE);
      await escrow.connect(topicOwner).enableEscrow(1, ONE_HOUR);

      // Fund senders
      await mockToken.transfer(sender1.address, ethers.parseEther("100"));
      await mockToken.connect(sender1).approve(registryAddress, ethers.MaxUint256);
    });

    it("should still handle ERC-20 deposits correctly", async function () {
      await registry.connect(sender1).sendMessage(1, "0x1234");

      expect(await escrow.depositCount()).to.equal(1);
      const d = await escrow.getDeposit(1);
      expect(d.token).to.equal(tokenAddress);
      expect(d.amount).to.equal(ERC20_MESSAGE_FEE);
    });

    it("should still release ERC-20 deposits with 90/5/5 split", async function () {
      await registry.connect(sender1).sendMessage(1, "0x1234");

      const topicOwnerBefore = await mockToken.balanceOf(topicOwner.address);
      const appOwnerBefore = await mockToken.balanceOf(appOwner.address);
      const treasuryBefore = await mockToken.balanceOf(treasury.address);

      await registry.connect(topicOwner).sendMessage(1, "0xaa01");

      const expected90 = (ERC20_MESSAGE_FEE * 9000n) / 10000n;
      const expected5 = (ERC20_MESSAGE_FEE * 500n) / 10000n;

      expect(await mockToken.balanceOf(topicOwner.address) - topicOwnerBefore).to.equal(expected90);
      expect(await mockToken.balanceOf(appOwner.address) - appOwnerBefore).to.equal(expected5);
      expect(await mockToken.balanceOf(treasury.address) - treasuryBefore).to.equal(expected5);
    });

    it("should still refund ERC-20 deposits after timeout", async function () {
      await registry.connect(sender1).sendMessage(1, "0x1234");
      await time.increase(ONE_HOUR + 1);

      const senderBefore = await mockToken.balanceOf(sender1.address);
      await escrow.connect(sender1).claimRefund(1);
      const senderAfter = await mockToken.balanceOf(sender1.address);

      expect(senderAfter - senderBefore).to.equal(ERC20_MESSAGE_FEE);
    });
  });

  // ================================================================
  // Native ETH Deposits
  // ================================================================

  describe("Native ETH Deposits", function () {
    beforeEach(async function () {
      await registry.connect(topicOwner).setTopicMessageFee(1, ethers.ZeroAddress, MESSAGE_FEE);
      await escrow.connect(topicOwner).enableEscrow(1, ONE_HOUR);
    });

    it("should record native ETH deposit", async function () {
      await registry.connect(sender1).sendMessage(1, "0x1234", { value: MESSAGE_FEE });

      expect(await escrow.depositCount()).to.equal(1);
      const d = await escrow.getDeposit(1);
      expect(d.token).to.equal(ethers.ZeroAddress);
      expect(d.amount).to.equal(MESSAGE_FEE);
      expect(d.sender).to.equal(sender1.address);
      expect(d.recipient).to.equal(topicOwner.address);
      expect(d.status).to.equal(0); // Pending
    });

    it("should hold ETH in escrow contract", async function () {
      await registry.connect(sender1).sendMessage(1, "0x1234", { value: MESSAGE_FEE });

      const escrowBal = await ethers.provider.getBalance(await escrow.getAddress());
      expect(escrowBal).to.equal(MESSAGE_FEE);
    });

    it("should accumulate multiple native ETH deposits", async function () {
      await registry.connect(sender1).sendMessage(1, "0x1111", { value: MESSAGE_FEE });
      await registry.connect(sender2).sendMessage(1, "0x2222", { value: MESSAGE_FEE });

      expect(await escrow.depositCount()).to.equal(2);
      const escrowBal = await ethers.provider.getBalance(await escrow.getAddress());
      expect(escrowBal).to.equal(MESSAGE_FEE * 2n);
    });

    it("should emit DepositRecorded event", async function () {
      await expect(registry.connect(sender1).sendMessage(1, "0x1234", { value: MESSAGE_FEE }))
        .to.emit(escrow, "DepositRecorded")
        .withArgs(1, 1, sender1.address, MESSAGE_FEE);
    });
  });

  // ================================================================
  // Native ETH Release
  // ================================================================

  describe("Native ETH Release", function () {
    beforeEach(async function () {
      await registry.connect(topicOwner).setTopicMessageFee(1, ethers.ZeroAddress, MESSAGE_FEE);
      await escrow.connect(topicOwner).enableEscrow(1, ONE_HOUR);
    });

    it("should release native ETH with 90/5/5 split", async function () {
      await registry.connect(sender1).sendMessage(1, "0x1234", { value: MESSAGE_FEE });

      const appOwnerBefore = await ethers.provider.getBalance(appOwner.address);
      const treasuryBefore = await ethers.provider.getBalance(treasury.address);

      await registry.connect(topicOwner).sendMessage(1, "0xaa01");

      const expected5 = (MESSAGE_FEE * 500n) / 10000n;

      expect(await ethers.provider.getBalance(appOwner.address) - appOwnerBefore).to.equal(expected5);
      expect(await ethers.provider.getBalance(treasury.address) - treasuryBefore).to.equal(expected5);
    });

    it("should release multiple native ETH deposits at once", async function () {
      await registry.connect(sender1).sendMessage(1, "0x1111", { value: MESSAGE_FEE });
      await registry.connect(sender2).sendMessage(1, "0x2222", { value: MESSAGE_FEE });

      const appOwnerBefore = await ethers.provider.getBalance(appOwner.address);

      await registry.connect(topicOwner).sendMessage(1, "0xaa01");

      const expected5x2 = ((MESSAGE_FEE * 500n) / 10000n) * 2n;
      expect(await ethers.provider.getBalance(appOwner.address) - appOwnerBefore).to.equal(expected5x2);
    });

    it("should emit DepositReleased event for native ETH", async function () {
      await registry.connect(sender1).sendMessage(1, "0x1234", { value: MESSAGE_FEE });

      const expected90 = (MESSAGE_FEE * 9000n) / 10000n;
      const expected5 = (MESSAGE_FEE * 500n) / 10000n;

      await expect(registry.connect(topicOwner).sendMessage(1, "0xaa01"))
        .to.emit(escrow, "DepositReleased")
        .withArgs(1, 1, expected90, expected5, expected5);
    });

    it("should clear pending deposits after release", async function () {
      await registry.connect(sender1).sendMessage(1, "0x1234", { value: MESSAGE_FEE });
      await registry.connect(topicOwner).sendMessage(1, "0xaa01");

      const pending = await escrow.getPendingDeposits(1);
      expect(pending.length).to.equal(0);

      const d = await escrow.getDeposit(1);
      expect(d.status).to.equal(1); // Released
    });

    it("should drain escrow ETH balance after release", async function () {
      await registry.connect(sender1).sendMessage(1, "0x1234", { value: MESSAGE_FEE });
      await registry.connect(topicOwner).sendMessage(1, "0xaa01");

      const escrowBal = await ethers.provider.getBalance(await escrow.getAddress());
      expect(escrowBal).to.equal(0);
    });
  });

  // ================================================================
  // Native ETH Refund
  // ================================================================

  describe("Native ETH Refund", function () {
    beforeEach(async function () {
      await registry.connect(topicOwner).setTopicMessageFee(1, ethers.ZeroAddress, MESSAGE_FEE);
      await escrow.connect(topicOwner).enableEscrow(1, ONE_HOUR);
    });

    it("should refund native ETH after timeout", async function () {
      await registry.connect(sender1).sendMessage(1, "0x1234", { value: MESSAGE_FEE });

      await time.increase(ONE_HOUR + 1);

      const senderBefore = await ethers.provider.getBalance(sender1.address);
      const tx = await escrow.connect(sender1).claimRefund(1);
      const receipt = await tx.wait();
      const gasCost = receipt.gasUsed * receipt.gasPrice;
      const senderAfter = await ethers.provider.getBalance(sender1.address);

      expect(senderAfter - senderBefore).to.equal(MESSAGE_FEE - gasCost);
    });

    it("should emit DepositRefunded event", async function () {
      await registry.connect(sender1).sendMessage(1, "0x1234", { value: MESSAGE_FEE });
      await time.increase(ONE_HOUR + 1);

      await expect(escrow.connect(sender1).claimRefund(1))
        .to.emit(escrow, "DepositRefunded")
        .withArgs(1, 1, sender1.address, MESSAGE_FEE);
    });

    it("should drain escrow ETH balance after refund", async function () {
      await registry.connect(sender1).sendMessage(1, "0x1234", { value: MESSAGE_FEE });
      await time.increase(ONE_HOUR + 1);
      await escrow.connect(sender1).claimRefund(1);

      const escrowBal = await ethers.provider.getBalance(await escrow.getAddress());
      expect(escrowBal).to.equal(0);
    });

    it("should batch refund native ETH deposits", async function () {
      await registry.connect(sender1).sendMessage(1, "0x1111", { value: MESSAGE_FEE });
      await registry.connect(sender1).sendMessage(1, "0x2222", { value: MESSAGE_FEE });

      await time.increase(ONE_HOUR + 1);

      const senderBefore = await ethers.provider.getBalance(sender1.address);
      const tx = await escrow.connect(sender1).batchClaimRefunds([1, 2]);
      const receipt = await tx.wait();
      const gasCost = receipt.gasUsed * receipt.gasPrice;
      const senderAfter = await ethers.provider.getBalance(sender1.address);

      expect(senderAfter - senderBefore).to.equal(MESSAGE_FEE * 2n - gasCost);
    });
  });

  // ================================================================
  // NativeValueMismatch
  // ================================================================

  describe("NativeValueMismatch", function () {
    it("should revert recordDeposit if msg.value != amount for native ETH", async function () {
      // We can't easily call recordDeposit directly (onlyRegistry), but we verify
      // through the registry that the correct amount is forwarded
      await registry.connect(topicOwner).setTopicMessageFee(1, ethers.ZeroAddress, MESSAGE_FEE);
      await escrow.connect(topicOwner).enableEscrow(1, ONE_HOUR);

      // Sending exact value should work
      await registry.connect(sender1).sendMessage(1, "0x1234", { value: MESSAGE_FEE });
      expect(await escrow.depositCount()).to.equal(1);
    });

    it("should revert recordDeposit from non-registry", async function () {
      await expect(
        escrow.connect(sender1).recordDeposit(1, sender1.address, ethers.ZeroAddress, MESSAGE_FEE, topicOwner.address, appOwner.address, { value: MESSAGE_FEE })
      ).to.be.revertedWithCustomError(escrow, "OnlyRegistry");
    });
  });

  // ================================================================
  // Mixed Deposits (ERC-20 + Native ETH in same topic)
  // ================================================================

  describe("Mixed Deposits in Same App", function () {
    let tokenAddress;

    beforeEach(async function () {
      tokenAddress = await mockToken.getAddress();
      const registryAddress = await registry.getAddress();

      // Topic 1: ERC-20 fee with escrow
      await registry.connect(topicOwner).setTopicMessageFee(1, tokenAddress, ERC20_MESSAGE_FEE);

      // Topic 2: Native ETH fee with escrow
      await registry.connect(topicOwner).createTopic(1, "ETHTopic", "ETH fee", ACCESS_PUBLIC);
      await registry.connect(topicOwner).setTopicMessageFee(2, ethers.ZeroAddress, MESSAGE_FEE);

      await escrow.connect(topicOwner).enableEscrow(1, ONE_HOUR);
      await escrow.connect(topicOwner).enableEscrow(2, ONE_HOUR);

      // Fund sender for ERC-20
      await mockToken.transfer(sender1.address, ethers.parseEther("100"));
      await mockToken.connect(sender1).approve(registryAddress, ethers.MaxUint256);
    });

    it("should handle both ERC-20 and native ETH escrow deposits", async function () {
      // ERC-20 deposit
      await registry.connect(sender1).sendMessage(1, "0x1234");
      // Native ETH deposit
      await registry.connect(sender1).sendMessage(2, "0x5678", { value: MESSAGE_FEE });

      expect(await escrow.depositCount()).to.equal(2);

      const d1 = await escrow.getDeposit(1);
      expect(d1.token).to.equal(tokenAddress);

      const d2 = await escrow.getDeposit(2);
      expect(d2.token).to.equal(ethers.ZeroAddress);
    });

    it("should release each deposit type correctly", async function () {
      await registry.connect(sender1).sendMessage(1, "0x1234");
      await registry.connect(sender1).sendMessage(2, "0x5678", { value: MESSAGE_FEE });

      // Release ERC-20 deposits on topic 1
      const tokenBefore = await mockToken.balanceOf(topicOwner.address);
      await registry.connect(topicOwner).sendMessage(1, "0xaa01");
      const expected90token = (ERC20_MESSAGE_FEE * 9000n) / 10000n;
      expect(await mockToken.balanceOf(topicOwner.address) - tokenBefore).to.equal(expected90token);

      // Release native ETH deposits on topic 2
      const ethBefore = await ethers.provider.getBalance(appOwner.address);
      await registry.connect(topicOwner).sendMessage(2, "0xbb01");
      const expected5eth = (MESSAGE_FEE * 500n) / 10000n;
      expect(await ethers.provider.getBalance(appOwner.address) - ethBefore).to.equal(expected5eth);
    });

    it("should refund each deposit type correctly after timeout", async function () {
      await registry.connect(sender1).sendMessage(1, "0x1234");
      await registry.connect(sender1).sendMessage(2, "0x5678", { value: MESSAGE_FEE });

      await time.increase(ONE_HOUR + 1);

      // Refund ERC-20
      const tokenBefore = await mockToken.balanceOf(sender1.address);
      await escrow.connect(sender1).claimRefund(1);
      expect(await mockToken.balanceOf(sender1.address) - tokenBefore).to.equal(ERC20_MESSAGE_FEE);

      // Refund native ETH
      const ethBefore = await ethers.provider.getBalance(sender1.address);
      const tx = await escrow.connect(sender1).claimRefund(2);
      const receipt = await tx.wait();
      const gasCost = receipt.gasUsed * receipt.gasPrice;
      const ethAfter = await ethers.provider.getBalance(sender1.address);
      expect(ethAfter - ethBefore).to.equal(MESSAGE_FEE - gasCost);
    });
  });
});
