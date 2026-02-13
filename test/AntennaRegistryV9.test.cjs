const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("AntennaRegistryV9", function () {
  let registry;
  let escrow;
  let mockToken;
  let owner, treasury, appOwner, topicOwner, sender1, sender2;

  const ACCESS_PUBLIC = 0;
  const MESSAGE_FEE = ethers.parseEther("0.02");
  const TOPIC_FEE = ethers.parseEther("0.05");
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
  });

  // ================================================================
  // Version
  // ================================================================

  describe("Version", function () {
    it("should return V9 version", async function () {
      expect(await registry.getVersion()).to.equal("9.0.0");
    });
  });

  // ================================================================
  // ERC-20 Backward Compatibility
  // ================================================================

  describe("ERC-20 Backward Compatibility", function () {
    let registryAddress, tokenAddress;

    beforeEach(async function () {
      registryAddress = await registry.getAddress();
      tokenAddress = await mockToken.getAddress();

      // Setup app and topic with ERC-20 fee
      await registry.connect(appOwner).createApplication("TestApp", "Test", "https://test.app", true);
      await registry.connect(topicOwner).createTopic(1, "TestTopic", "Test", ACCESS_PUBLIC);
      await registry.connect(topicOwner).setTopicMessageFee(1, tokenAddress, ERC20_MESSAGE_FEE);

      // Fund senders
      await mockToken.transfer(sender1.address, ethers.parseEther("100"));
      await mockToken.transfer(sender2.address, ethers.parseEther("100"));
      await mockToken.connect(sender1).approve(registryAddress, ethers.MaxUint256);
      await mockToken.connect(sender2).approve(registryAddress, ethers.MaxUint256);
    });

    it("should still collect ERC-20 fees with 90/5/5 split", async function () {
      const topicOwnerBefore = await mockToken.balanceOf(topicOwner.address);
      const appOwnerBefore = await mockToken.balanceOf(appOwner.address);
      const treasuryBefore = await mockToken.balanceOf(treasury.address);

      await registry.connect(sender1).sendMessage(1, "0x1234");

      const expected90 = (ERC20_MESSAGE_FEE * 9000n) / 10000n;
      const expected5 = (ERC20_MESSAGE_FEE * 500n) / 10000n;

      expect(await mockToken.balanceOf(topicOwner.address) - topicOwnerBefore).to.equal(expected90);
      expect(await mockToken.balanceOf(appOwner.address) - appOwnerBefore).to.equal(expected5);
      expect(await mockToken.balanceOf(treasury.address) - treasuryBefore).to.equal(expected5);
    });

    it("should still work with ERC-20 escrow", async function () {
      await escrow.connect(topicOwner).enableEscrow(1, ONE_HOUR);

      await registry.connect(sender1).sendMessage(1, "0x1234");

      expect(await escrow.depositCount()).to.equal(1);
      const d = await escrow.getDeposit(1);
      expect(d.token).to.equal(tokenAddress);
      expect(d.amount).to.equal(ERC20_MESSAGE_FEE);
    });
  });

  // ================================================================
  // Native ETH sendMessage
  // ================================================================

  describe("Native ETH sendMessage", function () {
    beforeEach(async function () {
      // Setup app and topic with native ETH fee (address(0))
      await registry.connect(appOwner).createApplication("TestApp", "Test", "https://test.app", true);
      await registry.connect(topicOwner).createTopic(1, "TestTopic", "Test", ACCESS_PUBLIC);
      await registry.connect(topicOwner).setTopicMessageFee(1, ethers.ZeroAddress, MESSAGE_FEE);
    });

    it("should collect native ETH fee with 90/5/5 split", async function () {
      const topicOwnerBefore = await ethers.provider.getBalance(topicOwner.address);
      const appOwnerBefore = await ethers.provider.getBalance(appOwner.address);
      const treasuryBefore = await ethers.provider.getBalance(treasury.address);

      await registry.connect(sender1).sendMessage(1, "0x1234", { value: MESSAGE_FEE });

      const expected90 = (MESSAGE_FEE * 9000n) / 10000n;
      const expected5 = (MESSAGE_FEE * 500n) / 10000n;

      expect(await ethers.provider.getBalance(topicOwner.address) - topicOwnerBefore).to.equal(expected90);
      expect(await ethers.provider.getBalance(appOwner.address) - appOwnerBefore).to.equal(expected5);
      expect(await ethers.provider.getBalance(treasury.address) - treasuryBefore).to.equal(expected5);
    });

    it("should emit FeeCollected event with address(0) token", async function () {
      const expected90 = (MESSAGE_FEE * 9000n) / 10000n;
      const expected5 = (MESSAGE_FEE * 500n) / 10000n;

      await expect(registry.connect(sender1).sendMessage(1, "0x1234", { value: MESSAGE_FEE }))
        .to.emit(registry, "FeeCollected")
        .withArgs(ethers.ZeroAddress, MESSAGE_FEE, topicOwner.address, expected90, appOwner.address, expected5, expected5);
    });

    it("should refund excess msg.value", async function () {
      const excess = ethers.parseEther("0.01");
      const totalSent = MESSAGE_FEE + excess;

      const senderBefore = await ethers.provider.getBalance(sender1.address);
      const tx = await registry.connect(sender1).sendMessage(1, "0x1234", { value: totalSent });
      const receipt = await tx.wait();
      const gasCost = receipt.gasUsed * receipt.gasPrice;
      const senderAfter = await ethers.provider.getBalance(sender1.address);

      // Sender should only lose feeAmount + gas, not the excess
      expect(senderBefore - senderAfter).to.equal(MESSAGE_FEE + gasCost);
    });

    it("should revert with InsufficientNativePayment when value too low", async function () {
      await expect(
        registry.connect(sender1).sendMessage(1, "0x1234", { value: MESSAGE_FEE - 1n })
      ).to.be.revertedWithCustomError(registry, "InsufficientNativePayment");
    });

    it("should revert with no value sent", async function () {
      await expect(
        registry.connect(sender1).sendMessage(1, "0x1234")
      ).to.be.revertedWithCustomError(registry, "InsufficientNativePayment");
    });

    it("should exempt topic owner from fee and refund any ETH sent", async function () {
      const ownerBefore = await ethers.provider.getBalance(topicOwner.address);
      const tx = await registry.connect(topicOwner).sendMessage(1, "0x1234", { value: MESSAGE_FEE });
      const receipt = await tx.wait();
      const gasCost = receipt.gasUsed * receipt.gasPrice;
      const ownerAfter = await ethers.provider.getBalance(topicOwner.address);

      // Topic owner should only lose gas, not the fee (ETH refunded)
      expect(ownerBefore - ownerAfter).to.equal(gasCost);
    });

    it("should exempt app owner from fee and refund any ETH sent", async function () {
      // Give app owner write access
      await registry.connect(topicOwner).setTopicPermission(1, appOwner.address, 2); // WRITE

      const ownerBefore = await ethers.provider.getBalance(appOwner.address);
      const tx = await registry.connect(appOwner).sendMessage(1, "0x1234", { value: MESSAGE_FEE });
      const receipt = await tx.wait();
      const gasCost = receipt.gasUsed * receipt.gasPrice;
      const ownerAfter = await ethers.provider.getBalance(appOwner.address);

      expect(ownerBefore - ownerAfter).to.equal(gasCost);
    });

    it("should work with exact value (no excess)", async function () {
      const topicOwnerBefore = await ethers.provider.getBalance(topicOwner.address);

      await registry.connect(sender1).sendMessage(1, "0x1234", { value: MESSAGE_FEE });

      const expected90 = (MESSAGE_FEE * 9000n) / 10000n;
      expect(await ethers.provider.getBalance(topicOwner.address) - topicOwnerBefore).to.equal(expected90);
    });

    it("should emit MessageSent event", async function () {
      await expect(registry.connect(sender1).sendMessage(1, "0x1234", { value: MESSAGE_FEE }))
        .to.emit(registry, "MessageSent");
    });
  });

  // ================================================================
  // Native ETH with Escrow
  // ================================================================

  describe("Native ETH with Escrow", function () {
    beforeEach(async function () {
      await registry.connect(appOwner).createApplication("TestApp", "Test", "https://test.app", true);
      await registry.connect(topicOwner).createTopic(1, "TestTopic", "Test", ACCESS_PUBLIC);
      await registry.connect(topicOwner).setTopicMessageFee(1, ethers.ZeroAddress, MESSAGE_FEE);
      await escrow.connect(topicOwner).enableEscrow(1, ONE_HOUR);
    });

    it("should deposit native ETH in escrow", async function () {
      await registry.connect(sender1).sendMessage(1, "0x1234", { value: MESSAGE_FEE });

      expect(await escrow.depositCount()).to.equal(1);
      const d = await escrow.getDeposit(1);
      expect(d.token).to.equal(ethers.ZeroAddress);
      expect(d.amount).to.equal(MESSAGE_FEE);
      expect(d.sender).to.equal(sender1.address);

      // Escrow should hold the ETH
      const escrowBal = await ethers.provider.getBalance(await escrow.getAddress());
      expect(escrowBal).to.equal(MESSAGE_FEE);
    });

    it("should release native ETH deposits with 90/5/5 split on topic owner response", async function () {
      await registry.connect(sender1).sendMessage(1, "0x1234", { value: MESSAGE_FEE });

      const topicOwnerBefore = await ethers.provider.getBalance(topicOwner.address);
      const appOwnerBefore = await ethers.provider.getBalance(appOwner.address);
      const treasuryBefore = await ethers.provider.getBalance(treasury.address);

      // Topic owner responds — triggers release
      const tx = await registry.connect(topicOwner).sendMessage(1, "0xaa01");
      await tx.wait();

      const expected90 = (MESSAGE_FEE * 9000n) / 10000n;
      const expected5 = (MESSAGE_FEE * 500n) / 10000n;

      expect(await ethers.provider.getBalance(appOwner.address) - appOwnerBefore).to.equal(expected5);
      expect(await ethers.provider.getBalance(treasury.address) - treasuryBefore).to.equal(expected5);

      // Topic owner gets 90% minus gas costs
      const topicOwnerAfter = await ethers.provider.getBalance(topicOwner.address);
      const topicOwnerDelta = topicOwnerAfter - topicOwnerBefore;
      // Delta should be positive (received 90% minus gas) — verify received at least 90% - some gas
      expect(topicOwnerDelta).to.be.gt(expected90 - ethers.parseEther("0.01"));
    });

    it("should refund native ETH after timeout", async function () {
      await registry.connect(sender1).sendMessage(1, "0x1234", { value: MESSAGE_FEE });

      await time.increase(ONE_HOUR + 1);

      const senderBefore = await ethers.provider.getBalance(sender1.address);
      const tx = await escrow.connect(sender1).claimRefund(1);
      const receipt = await tx.wait();
      const gasCost = receipt.gasUsed * receipt.gasPrice;
      const senderAfter = await ethers.provider.getBalance(sender1.address);

      // Sender should get full refund minus gas
      expect(senderAfter - senderBefore).to.equal(MESSAGE_FEE - gasCost);
    });

    it("should refund excess ETH to sender when using escrow", async function () {
      const excess = ethers.parseEther("0.01");
      const totalSent = MESSAGE_FEE + excess;

      const senderBefore = await ethers.provider.getBalance(sender1.address);
      const tx = await registry.connect(sender1).sendMessage(1, "0x1234", { value: totalSent });
      const receipt = await tx.wait();
      const gasCost = receipt.gasUsed * receipt.gasPrice;
      const senderAfter = await ethers.provider.getBalance(sender1.address);

      // Only fee + gas consumed, excess refunded
      expect(senderBefore - senderAfter).to.equal(MESSAGE_FEE + gasCost);

      // Escrow should hold exactly the fee
      const escrowBal = await ethers.provider.getBalance(await escrow.getAddress());
      expect(escrowBal).to.equal(MESSAGE_FEE);
    });
  });

  // ================================================================
  // Native ETH createTopic
  // ================================================================

  describe("Native ETH createTopic", function () {
    beforeEach(async function () {
      // Create app with native ETH topic creation fee
      await registry.connect(appOwner).createApplication("TestApp", "Test", "https://test.app", true);
      await registry.connect(appOwner).setTopicCreationFee(1, ethers.ZeroAddress, TOPIC_FEE);
    });

    it("should collect native ETH topic creation fee with 95/5 split (recipient==appOwner)", async function () {
      const appOwnerBefore = await ethers.provider.getBalance(appOwner.address);
      const treasuryBefore = await ethers.provider.getBalance(treasury.address);

      await registry.connect(sender1).createTopic(1, "NewTopic", "Test", ACCESS_PUBLIC, { value: TOPIC_FEE });

      // App owner is both recipient and appOwner → 95% combined
      const expected95 = TOPIC_FEE - ((TOPIC_FEE * 500n) / 10000n);
      const expected5 = (TOPIC_FEE * 500n) / 10000n;

      expect(await ethers.provider.getBalance(appOwner.address) - appOwnerBefore).to.equal(expected95);
      expect(await ethers.provider.getBalance(treasury.address) - treasuryBefore).to.equal(expected5);
    });

    it("should refund excess ETH on createTopic", async function () {
      const excess = ethers.parseEther("0.01");
      const totalSent = TOPIC_FEE + excess;

      const senderBefore = await ethers.provider.getBalance(sender1.address);
      const tx = await registry.connect(sender1).createTopic(1, "NewTopic", "Test", ACCESS_PUBLIC, { value: totalSent });
      const receipt = await tx.wait();
      const gasCost = receipt.gasUsed * receipt.gasPrice;
      const senderAfter = await ethers.provider.getBalance(sender1.address);

      expect(senderBefore - senderAfter).to.equal(TOPIC_FEE + gasCost);
    });

    it("should revert with InsufficientNativePayment on createTopic", async function () {
      await expect(
        registry.connect(sender1).createTopic(1, "NewTopic", "Test", ACCESS_PUBLIC, { value: TOPIC_FEE - 1n })
      ).to.be.revertedWithCustomError(registry, "InsufficientNativePayment");
    });

    it("should create topic without fee when no fee is set", async function () {
      // Create another app with no fee
      await registry.connect(appOwner).createApplication("FreeApp", "Free", "https://free.app", true);

      await registry.connect(sender1).createTopic(2, "FreeTopic", "Test", ACCESS_PUBLIC);

      const topic = await registry.topics(1);
      expect(topic.id).to.equal(1);
    });
  });

  // ================================================================
  // Mixed Mode (ERC-20 + Native ETH topics coexist)
  // ================================================================

  describe("Mixed Mode", function () {
    let tokenAddress;

    beforeEach(async function () {
      tokenAddress = await mockToken.getAddress();
      const registryAddress = await registry.getAddress();

      await registry.connect(appOwner).createApplication("TestApp", "Test", "https://test.app", true);

      // Topic 1: ERC-20 fee
      await registry.connect(topicOwner).createTopic(1, "ERC20Topic", "ERC20 fee", ACCESS_PUBLIC);
      await registry.connect(topicOwner).setTopicMessageFee(1, tokenAddress, ERC20_MESSAGE_FEE);

      // Topic 2: Native ETH fee
      await registry.connect(topicOwner).createTopic(1, "ETHTopic", "ETH fee", ACCESS_PUBLIC);
      await registry.connect(topicOwner).setTopicMessageFee(2, ethers.ZeroAddress, MESSAGE_FEE);

      // Fund sender for ERC-20
      await mockToken.transfer(sender1.address, ethers.parseEther("100"));
      await mockToken.connect(sender1).approve(registryAddress, ethers.MaxUint256);
    });

    it("should handle ERC-20 topic and native ETH topic in same app", async function () {
      // Send ERC-20 message
      const topicOwnerTokenBefore = await mockToken.balanceOf(topicOwner.address);
      await registry.connect(sender1).sendMessage(1, "0x1234");
      const expected90token = (ERC20_MESSAGE_FEE * 9000n) / 10000n;
      expect(await mockToken.balanceOf(topicOwner.address) - topicOwnerTokenBefore).to.equal(expected90token);

      // Send native ETH message
      const topicOwnerEthBefore = await ethers.provider.getBalance(topicOwner.address);
      await registry.connect(sender1).sendMessage(2, "0x5678", { value: MESSAGE_FEE });
      const expected90eth = (MESSAGE_FEE * 9000n) / 10000n;
      expect(await ethers.provider.getBalance(topicOwner.address) - topicOwnerEthBefore).to.equal(expected90eth);
    });

    it("should not require ETH value for ERC-20 fee topics", async function () {
      // No value needed for ERC-20 topics
      await registry.connect(sender1).sendMessage(1, "0x1234");
    });

    it("should not require token approval for native ETH fee topics", async function () {
      // Sender2 has no token approval but can send ETH
      await registry.connect(sender2).sendMessage(2, "0x1234", { value: MESSAGE_FEE });
    });
  });
});
