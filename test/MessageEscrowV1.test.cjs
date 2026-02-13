const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("MessageEscrowV1", function () {
  let registry;
  let escrow;
  let mockToken;
  let owner, treasury, appOwner, topicOwner, sender1, sender2;

  // Constants
  const ROLE_MEMBER = 1;
  const ROLE_ADMIN = 8;
  const ACCESS_PUBLIC = 0;
  const PERMISSION_ADMIN = 4;

  // Fee constants
  const MESSAGE_FEE = ethers.parseEther("1");
  const ONE_HOUR = 3600;
  const ONE_DAY = 86400;

  let registryAddress;
  let escrowAddress;
  let tokenAddress;

  beforeEach(async function () {
    [owner, treasury, appOwner, topicOwner, sender1, sender2] = await ethers.getSigners();

    // Deploy mock ERC20
    const MockToken = await ethers.getContractFactory("MockERC20");
    mockToken = await MockToken.deploy("Mock Token", "MTK", ethers.parseEther("1000000"));
    await mockToken.waitForDeployment();
    tokenAddress = await mockToken.getAddress();

    // Deploy registry V1 → V8
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
    registry = await upgrades.upgradeProxy(await v7.getAddress(), V8);
    registryAddress = await registry.getAddress();

    // Deploy escrow
    const Escrow = await ethers.getContractFactory("MessageEscrowV1");
    escrow = await upgrades.deployProxy(Escrow, [registryAddress, treasury.address], {
      initializer: "initialize",
      kind: "uups",
    });
    await escrow.waitForDeployment();
    escrowAddress = await escrow.getAddress();

    // Wire escrow to registry
    await registry.setEscrowContract(escrowAddress);

    // Create application (appOwner is the owner)
    await registry.connect(appOwner).createApplication("TestApp", "Test", "https://test.app", true);

    // Create topic (topicOwner is the owner)
    await registry.connect(topicOwner).createTopic(1, "TestTopic", "A test topic", ACCESS_PUBLIC);

    // Set message fee on topic
    await registry.connect(topicOwner).setTopicMessageFee(1, tokenAddress, MESSAGE_FEE);

    // Distribute tokens to senders and approve
    await mockToken.transfer(sender1.address, ethers.parseEther("100"));
    await mockToken.transfer(sender2.address, ethers.parseEther("100"));
    await mockToken.connect(sender1).approve(registryAddress, ethers.MaxUint256);
    await mockToken.connect(sender2).approve(registryAddress, ethers.MaxUint256);
  });

  // ================================================================
  // Version & Initialization
  // ================================================================

  describe("Version & Initialization", function () {
    it("should return correct version", async function () {
      expect(await escrow.getVersion()).to.equal("1.0.0");
    });

    it("should set registry and treasury on init", async function () {
      expect(await escrow.registry()).to.equal(registryAddress);
      expect(await escrow.treasury()).to.equal(treasury.address);
    });

    it("should start with zero deposit count", async function () {
      expect(await escrow.depositCount()).to.equal(0);
    });
  });

  // ================================================================
  // Admin Functions
  // ================================================================

  describe("Admin Functions", function () {
    it("should allow owner to set registry", async function () {
      await escrow.setRegistry(sender1.address);
      expect(await escrow.registry()).to.equal(sender1.address);
    });

    it("should allow owner to set treasury", async function () {
      await escrow.setTreasury(sender1.address);
      expect(await escrow.treasury()).to.equal(sender1.address);
    });

    it("should revert when non-owner sets registry", async function () {
      await expect(
        escrow.connect(sender1).setRegistry(sender1.address)
      ).to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount");
    });

    it("should revert when non-owner sets treasury", async function () {
      await expect(
        escrow.connect(sender1).setTreasury(sender1.address)
      ).to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount");
    });
  });

  // ================================================================
  // Escrow Configuration
  // ================================================================

  describe("Escrow Configuration", function () {
    it("should allow topic owner to enable escrow", async function () {
      await expect(escrow.connect(topicOwner).enableEscrow(1, ONE_HOUR))
        .to.emit(escrow, "EscrowEnabled")
        .withArgs(1, ONE_HOUR);

      expect(await escrow.isEscrowEnabled(1)).to.equal(true);
      expect(await escrow.topicEscrowTimeout(1)).to.equal(ONE_HOUR);
    });

    it("should allow topic owner to disable escrow", async function () {
      await escrow.connect(topicOwner).enableEscrow(1, ONE_HOUR);

      await expect(escrow.connect(topicOwner).disableEscrow(1))
        .to.emit(escrow, "EscrowDisabled")
        .withArgs(1);

      expect(await escrow.isEscrowEnabled(1)).to.equal(false);
    });

    it("should revert when non-topic-owner enables escrow", async function () {
      await expect(
        escrow.connect(sender1).enableEscrow(1, ONE_HOUR)
      ).to.be.revertedWithCustomError(escrow, "NotTopicOwner");
    });

    it("should revert when non-topic-owner disables escrow", async function () {
      await escrow.connect(topicOwner).enableEscrow(1, ONE_HOUR);
      await expect(
        escrow.connect(sender1).disableEscrow(1)
      ).to.be.revertedWithCustomError(escrow, "NotTopicOwner");
    });

    it("should revert for timeout below minimum (60s)", async function () {
      await expect(
        escrow.connect(topicOwner).enableEscrow(1, 59)
      ).to.be.revertedWithCustomError(escrow, "InvalidTimeout");
    });

    it("should revert for timeout above maximum (7 days)", async function () {
      const sevenDaysPlus = 7 * 24 * 3600 + 1;
      await expect(
        escrow.connect(topicOwner).enableEscrow(1, sevenDaysPlus)
      ).to.be.revertedWithCustomError(escrow, "InvalidTimeout");
    });

    it("should accept minimum timeout (60s)", async function () {
      await escrow.connect(topicOwner).enableEscrow(1, 60);
      expect(await escrow.topicEscrowTimeout(1)).to.equal(60);
    });

    it("should accept maximum timeout (7 days)", async function () {
      const sevenDays = 7 * 24 * 3600;
      await escrow.connect(topicOwner).enableEscrow(1, sevenDays);
      expect(await escrow.topicEscrowTimeout(1)).to.equal(sevenDays);
    });

    it("should revert enable for non-existent topic", async function () {
      await expect(
        escrow.connect(topicOwner).enableEscrow(999, ONE_HOUR)
      ).to.be.revertedWithCustomError(escrow, "TopicNotFound");
    });
  });

  // ================================================================
  // Deposit Creation via sendMessage
  // ================================================================

  describe("Deposit Creation", function () {
    beforeEach(async function () {
      // Enable escrow for topic 1
      await escrow.connect(topicOwner).enableEscrow(1, ONE_HOUR);
    });

    it("should route fee to escrow when escrow is enabled", async function () {
      const escrowBalBefore = await mockToken.balanceOf(escrowAddress);

      await registry.connect(sender1).sendMessage(1, "0x1234");

      const escrowBalAfter = await mockToken.balanceOf(escrowAddress);
      expect(escrowBalAfter - escrowBalBefore).to.equal(MESSAGE_FEE);

      // Verify deposit was recorded
      expect(await escrow.depositCount()).to.equal(1);
      const d = await escrow.getDeposit(1);
      expect(d.topicId).to.equal(1);
      expect(d.sender).to.equal(sender1.address);
      expect(d.recipient).to.equal(topicOwner.address);
      expect(d.token).to.equal(tokenAddress);
      expect(d.amount).to.equal(MESSAGE_FEE);
      expect(d.appOwner).to.equal(appOwner.address);
      expect(d.status).to.equal(0);
    });

    it("should add deposit to pending list", async function () {
      await registry.connect(sender1).sendMessage(1, "0x1234");

      const pending = await escrow.getPendingDeposits(1);
      expect(pending.length).to.equal(1);
      expect(pending[0]).to.equal(1);
    });

    it("should accumulate multiple deposits", async function () {
      await registry.connect(sender1).sendMessage(1, "0x1111");
      await registry.connect(sender2).sendMessage(1, "0x2222");

      expect(await escrow.depositCount()).to.equal(2);
      const pending = await escrow.getPendingDeposits(1);
      expect(pending.length).to.equal(2);
    });

    it("should emit DepositRecorded event", async function () {
      await expect(registry.connect(sender1).sendMessage(1, "0x1234"))
        .to.emit(escrow, "DepositRecorded")
        .withArgs(1, 1, sender1.address, MESSAGE_FEE);
    });

    it("should skip escrow for exempt users (topic owner)", async function () {
      const escrowBalBefore = await mockToken.balanceOf(escrowAddress);

      await registry.connect(topicOwner).sendMessage(1, "0x1234");

      const escrowBalAfter = await mockToken.balanceOf(escrowAddress);
      expect(escrowBalAfter - escrowBalBefore).to.equal(0);
      expect(await escrow.depositCount()).to.equal(0);
    });

    it("should skip escrow for exempt users (app owner)", async function () {
      await registry.connect(appOwner).sendMessage(1, "0x1234");
      expect(await escrow.depositCount()).to.equal(0);
    });

    it("should use normal V7 path when escrow is disabled", async function () {
      // Disable escrow
      await escrow.connect(topicOwner).disableEscrow(1);

      const topicOwnerBefore = await mockToken.balanceOf(topicOwner.address);
      await registry.connect(sender1).sendMessage(1, "0x1234");
      const topicOwnerAfter = await mockToken.balanceOf(topicOwner.address);

      // Topic owner should get 90% directly (V7 path)
      const expected90 = (MESSAGE_FEE * 9000n) / 10000n;
      expect(topicOwnerAfter - topicOwnerBefore).to.equal(expected90);
      expect(await escrow.depositCount()).to.equal(0);
    });
  });

  // ================================================================
  // Release on Topic Owner Response
  // ================================================================

  describe("Release on Response", function () {
    beforeEach(async function () {
      await escrow.connect(topicOwner).enableEscrow(1, ONE_HOUR);
    });

    it("should release pending deposits when topic owner responds", async function () {
      // Sender sends a message (fee goes to escrow)
      await registry.connect(sender1).sendMessage(1, "0x1111");

      const topicOwnerBefore = await mockToken.balanceOf(topicOwner.address);
      const appOwnerBefore = await mockToken.balanceOf(appOwner.address);
      const treasuryBefore = await mockToken.balanceOf(treasury.address);

      // Topic owner responds — triggers release
      await registry.connect(topicOwner).sendMessage(1, "0xaa01");

      const topicOwnerAfter = await mockToken.balanceOf(topicOwner.address);
      const appOwnerAfter = await mockToken.balanceOf(appOwner.address);
      const treasuryAfter = await mockToken.balanceOf(treasury.address);

      // 90/5/5 split
      const expected90 = (MESSAGE_FEE * 9000n) / 10000n;
      const expected5 = (MESSAGE_FEE * 500n) / 10000n;

      expect(topicOwnerAfter - topicOwnerBefore).to.equal(expected90);
      expect(appOwnerAfter - appOwnerBefore).to.equal(expected5);
      expect(treasuryAfter - treasuryBefore).to.equal(expected5);
    });

    it("should release multiple deposits at once", async function () {
      await registry.connect(sender1).sendMessage(1, "0x1111");
      await registry.connect(sender2).sendMessage(1, "0x2222");

      const topicOwnerBefore = await mockToken.balanceOf(topicOwner.address);

      // Topic owner responds
      await registry.connect(topicOwner).sendMessage(1, "0xaa01");

      const topicOwnerAfter = await mockToken.balanceOf(topicOwner.address);

      // Should get 90% of both deposits
      const expected90x2 = ((MESSAGE_FEE * 9000n) / 10000n) * 2n;
      expect(topicOwnerAfter - topicOwnerBefore).to.equal(expected90x2);
    });

    it("should clear pending deposits after release", async function () {
      await registry.connect(sender1).sendMessage(1, "0x1111");

      // Topic owner responds
      await registry.connect(topicOwner).sendMessage(1, "0xaa01");

      const pending = await escrow.getPendingDeposits(1);
      expect(pending.length).to.equal(0);

      // Deposit should be marked resolved
      const d = await escrow.getDeposit(1);
      expect(d.status).to.equal(1);
    });

    it("should emit DepositReleased event", async function () {
      await registry.connect(sender1).sendMessage(1, "0x1111");

      const expected90 = (MESSAGE_FEE * 9000n) / 10000n;
      const expected5 = (MESSAGE_FEE * 500n) / 10000n;

      await expect(registry.connect(topicOwner).sendMessage(1, "0xaa01"))
        .to.emit(escrow, "DepositReleased")
        .withArgs(1, 1, expected90, expected5, expected5);
    });

    it("should be a no-op when there are no pending deposits", async function () {
      // Topic owner sends without any pending deposits — should not revert
      await registry.connect(topicOwner).sendMessage(1, "0xbb01");
    });

    it("should handle same-address optimization (recipient == appOwner)", async function () {
      // Create app where appOwner is also topicOwner
      await registry.connect(appOwner).createApplication("SelfApp", "Self", "https://self.app", true);
      await registry.connect(appOwner).createTopic(2, "SelfTopic", "Self owned", ACCESS_PUBLIC);
      await registry.connect(appOwner).setTopicMessageFee(2, tokenAddress, MESSAGE_FEE);
      await escrow.connect(appOwner).enableEscrow(2, ONE_HOUR);

      await registry.connect(sender1).sendMessage(2, "0x1111");

      const appOwnerBefore = await mockToken.balanceOf(appOwner.address);

      // appOwner responds (they are both topic owner AND app owner)
      await registry.connect(appOwner).sendMessage(2, "0xaa01");

      const appOwnerAfter = await mockToken.balanceOf(appOwner.address);

      // Should get 90% + 5% = 95% in a single transfer
      const expected95 = MESSAGE_FEE - ((MESSAGE_FEE * 500n) / 10000n);
      expect(appOwnerAfter - appOwnerBefore).to.equal(expected95);
    });
  });

  // ================================================================
  // Refund After Timeout
  // ================================================================

  describe("Refund After Timeout", function () {
    beforeEach(async function () {
      await escrow.connect(topicOwner).enableEscrow(1, ONE_HOUR);
    });

    it("should allow sender to claim refund after timeout", async function () {
      await registry.connect(sender1).sendMessage(1, "0x1111");

      const senderBefore = await mockToken.balanceOf(sender1.address);

      // Advance time past timeout
      await time.increase(ONE_HOUR + 1);

      await escrow.connect(sender1).claimRefund(1);

      const senderAfter = await mockToken.balanceOf(sender1.address);
      expect(senderAfter - senderBefore).to.equal(MESSAGE_FEE);
    });

    it("should mark deposit as Refunded after refund", async function () {
      await registry.connect(sender1).sendMessage(1, "0x1111");
      await time.increase(ONE_HOUR + 1);
      await escrow.connect(sender1).claimRefund(1);

      const d = await escrow.getDeposit(1);
      expect(d.status).to.equal(2); // Refunded
    });

    it("should remove deposit from pending list after refund", async function () {
      await registry.connect(sender1).sendMessage(1, "0x1111");
      await time.increase(ONE_HOUR + 1);
      await escrow.connect(sender1).claimRefund(1);

      const pending = await escrow.getPendingDeposits(1);
      expect(pending.length).to.equal(0);
    });

    it("should emit DepositRefunded event", async function () {
      await registry.connect(sender1).sendMessage(1, "0x1111");
      await time.increase(ONE_HOUR + 1);

      await expect(escrow.connect(sender1).claimRefund(1))
        .to.emit(escrow, "DepositRefunded")
        .withArgs(1, 1, sender1.address, MESSAGE_FEE);
    });

    it("should revert if timeout has not expired", async function () {
      await registry.connect(sender1).sendMessage(1, "0x1111");

      await expect(
        escrow.connect(sender1).claimRefund(1)
      ).to.be.revertedWithCustomError(escrow, "TimeoutNotExpired");
    });

    it("should revert if not the original sender", async function () {
      await registry.connect(sender1).sendMessage(1, "0x1111");
      await time.increase(ONE_HOUR + 1);

      await expect(
        escrow.connect(sender2).claimRefund(1)
      ).to.be.revertedWithCustomError(escrow, "NotDepositor");
    });

    it("should revert for non-existent deposit", async function () {
      await expect(
        escrow.connect(sender1).claimRefund(999)
      ).to.be.revertedWithCustomError(escrow, "DepositNotFound");
    });

    it("should revert for already-resolved deposit (double refund)", async function () {
      await registry.connect(sender1).sendMessage(1, "0x1111");
      await time.increase(ONE_HOUR + 1);
      await escrow.connect(sender1).claimRefund(1);

      await expect(
        escrow.connect(sender1).claimRefund(1)
      ).to.be.revertedWithCustomError(escrow, "AlreadyResolved");
    });

    it("should revert refund after deposit was released", async function () {
      await registry.connect(sender1).sendMessage(1, "0x1111");

      // Topic owner responds (releases deposit)
      await registry.connect(topicOwner).sendMessage(1, "0xaa01");

      // Now try to refund — should fail
      await time.increase(ONE_HOUR + 1);
      await expect(
        escrow.connect(sender1).claimRefund(1)
      ).to.be.revertedWithCustomError(escrow, "AlreadyResolved");
    });

    it("canClaimRefund should return correct status", async function () {
      await registry.connect(sender1).sendMessage(1, "0x1111");

      // Before timeout
      expect(await escrow.canClaimRefund(1)).to.equal(false);

      // After timeout
      await time.increase(ONE_HOUR + 1);
      expect(await escrow.canClaimRefund(1)).to.equal(true);

      // After claiming
      await escrow.connect(sender1).claimRefund(1);
      expect(await escrow.canClaimRefund(1)).to.equal(false);
    });
  });

  // ================================================================
  // Batch Refunds
  // ================================================================

  describe("Batch Refunds", function () {
    beforeEach(async function () {
      await escrow.connect(topicOwner).enableEscrow(1, ONE_HOUR);
    });

    it("should allow batch refund of multiple deposits", async function () {
      await registry.connect(sender1).sendMessage(1, "0x1111");
      await registry.connect(sender1).sendMessage(1, "0x2222");

      await time.increase(ONE_HOUR + 1);

      const senderBefore = await mockToken.balanceOf(sender1.address);
      await escrow.connect(sender1).batchClaimRefunds([1, 2]);
      const senderAfter = await mockToken.balanceOf(sender1.address);

      expect(senderAfter - senderBefore).to.equal(MESSAGE_FEE * 2n);
    });

    it("should revert batch over MAX_BATCH_SIZE", async function () {
      const ids = Array.from({ length: 51 }, (_, i) => i + 1);
      await expect(
        escrow.connect(sender1).batchClaimRefunds(ids)
      ).to.be.revertedWithCustomError(escrow, "BatchTooLarge");
    });
  });

  // ================================================================
  // Batch Cap for Release
  // ================================================================

  describe("Release Batch Cap", function () {
    // This test creates 52 deposits to verify the 50-batch cap
    // We need a lot of tokens for this
    beforeEach(async function () {
      await escrow.connect(topicOwner).enableEscrow(1, ONE_HOUR);
      // Give sender1 enough tokens
      await mockToken.mint(sender1.address, ethers.parseEther("1000"));
    });

    it("should process max 50 deposits per release call", async function () {
      // Create 52 deposits
      for (let i = 0; i < 52; i++) {
        await registry.connect(sender1).sendMessage(1, "0x" + i.toString(16).padStart(4, "0"));
      }

      expect(await escrow.depositCount()).to.equal(52);
      let pending = await escrow.getPendingDeposits(1);
      expect(pending.length).to.equal(52);

      // Topic owner responds — should release max 50
      await registry.connect(topicOwner).sendMessage(1, "0xaa01");

      pending = await escrow.getPendingDeposits(1);
      expect(pending.length).to.equal(2); // 52 - 50 = 2 remaining

      // Second response releases remaining 2
      await registry.connect(topicOwner).sendMessage(1, "0xaa02");

      pending = await escrow.getPendingDeposits(1);
      expect(pending.length).to.equal(0);
    });
  });

  // ================================================================
  // Edge Cases
  // ================================================================

  describe("Edge Cases", function () {
    it("should keep pending deposits when escrow is disabled", async function () {
      await escrow.connect(topicOwner).enableEscrow(1, ONE_HOUR);
      await registry.connect(sender1).sendMessage(1, "0x1111");

      // Disable escrow
      await escrow.connect(topicOwner).disableEscrow(1);

      // Deposit should still be pending
      const pending = await escrow.getPendingDeposits(1);
      expect(pending.length).to.equal(1);

      // Sender can still refund after timeout
      await time.increase(ONE_HOUR + 1);
      await escrow.connect(sender1).claimRefund(1);
    });

    it("should still release pending deposits after escrow is disabled", async function () {
      await escrow.connect(topicOwner).enableEscrow(1, ONE_HOUR);
      await registry.connect(sender1).sendMessage(1, "0x1111");

      // Disable escrow
      await escrow.connect(topicOwner).disableEscrow(1);

      // Topic owner responds — should still release old deposits
      const topicOwnerBefore = await mockToken.balanceOf(topicOwner.address);
      await registry.connect(topicOwner).sendMessage(1, "0xaa01");
      const topicOwnerAfter = await mockToken.balanceOf(topicOwner.address);

      const expected90 = (MESSAGE_FEE * 9000n) / 10000n;
      expect(topicOwnerAfter - topicOwnerBefore).to.equal(expected90);
    });

    it("should handle re-enable after disable", async function () {
      await escrow.connect(topicOwner).enableEscrow(1, ONE_HOUR);
      await escrow.connect(topicOwner).disableEscrow(1);
      await escrow.connect(topicOwner).enableEscrow(1, ONE_DAY);

      expect(await escrow.isEscrowEnabled(1)).to.equal(true);
      expect(await escrow.topicEscrowTimeout(1)).to.equal(ONE_DAY);
    });

    it("should handle new deposits going direct when escrow disabled", async function () {
      await escrow.connect(topicOwner).enableEscrow(1, ONE_HOUR);
      await registry.connect(sender1).sendMessage(1, "0x1111"); // → escrow

      await escrow.connect(topicOwner).disableEscrow(1);

      // New message should go through V7 direct path
      const topicOwnerBefore = await mockToken.balanceOf(topicOwner.address);
      await registry.connect(sender2).sendMessage(1, "0x2222"); // → direct
      const topicOwnerAfter = await mockToken.balanceOf(topicOwner.address);

      const expected90 = (MESSAGE_FEE * 9000n) / 10000n;
      expect(topicOwnerAfter - topicOwnerBefore).to.equal(expected90);

      // First deposit still in escrow
      expect(await escrow.depositCount()).to.equal(1);
    });
  });

  // ================================================================
  // Security
  // ================================================================

  describe("Security", function () {
    it("should revert recordDeposit from non-registry", async function () {
      await expect(
        escrow.connect(sender1).recordDeposit(1, sender1.address, tokenAddress, MESSAGE_FEE, topicOwner.address, appOwner.address)
      ).to.be.revertedWithCustomError(escrow, "OnlyRegistry");
    });

    it("should revert releaseForTopic from non-registry", async function () {
      await expect(
        escrow.connect(sender1).releaseForTopic(1)
      ).to.be.revertedWithCustomError(escrow, "OnlyRegistry");
    });

    it("should prevent double-release (resolved deposits are skipped)", async function () {
      await escrow.connect(topicOwner).enableEscrow(1, ONE_HOUR);
      await registry.connect(sender1).sendMessage(1, "0x1111");

      // First release
      await registry.connect(topicOwner).sendMessage(1, "0xaa01");

      // Deposit is resolved, pending list is cleared
      const d = await escrow.getDeposit(1);
      expect(d.status).to.equal(1);

      // Second release should be a no-op (no pending)
      await registry.connect(topicOwner).sendMessage(1, "0xaa02");
    });
  });

  // ================================================================
  // View Functions
  // ================================================================

  describe("View Functions", function () {
    it("getDeposit should return all fields", async function () {
      await escrow.connect(topicOwner).enableEscrow(1, ONE_HOUR);
      await registry.connect(sender1).sendMessage(1, "0x1234");

      const d = await escrow.getDeposit(1);
      expect(d.id).to.equal(1);
      expect(d.topicId).to.equal(1);
      expect(d.sender).to.equal(sender1.address);
      expect(d.recipient).to.equal(topicOwner.address);
      expect(d.token).to.equal(tokenAddress);
      expect(d.amount).to.equal(MESSAGE_FEE);
      expect(d.appOwner).to.equal(appOwner.address);
      expect(d.timeout).to.equal(ONE_HOUR);
      expect(d.status).to.equal(0);
    });

    it("getPendingDeposits should return correct list", async function () {
      await escrow.connect(topicOwner).enableEscrow(1, ONE_HOUR);

      expect((await escrow.getPendingDeposits(1)).length).to.equal(0);

      await registry.connect(sender1).sendMessage(1, "0x1111");
      await registry.connect(sender2).sendMessage(1, "0x2222");

      const pending = await escrow.getPendingDeposits(1);
      expect(pending.length).to.equal(2);
      expect(pending[0]).to.equal(1);
      expect(pending[1]).to.equal(2);
    });

    it("canClaimRefund should return false for non-existent deposit", async function () {
      expect(await escrow.canClaimRefund(999)).to.equal(false);
    });

    it("getDepositStatus should return Pending (0) for new deposit", async function () {
      await escrow.connect(topicOwner).enableEscrow(1, ONE_HOUR);
      await registry.connect(sender1).sendMessage(1, "0x1234");

      expect(await escrow.getDepositStatus(1)).to.equal(0);
    });

    it("getDepositStatus should return Released (1) after release", async function () {
      await escrow.connect(topicOwner).enableEscrow(1, ONE_HOUR);
      await registry.connect(sender1).sendMessage(1, "0x1234");
      await registry.connect(topicOwner).sendMessage(1, "0xaa01");

      expect(await escrow.getDepositStatus(1)).to.equal(1);
    });

    it("getDepositStatus should return Refunded (2) after refund", async function () {
      await escrow.connect(topicOwner).enableEscrow(1, ONE_HOUR);
      await registry.connect(sender1).sendMessage(1, "0x1234");
      await time.increase(ONE_HOUR + 1);
      await escrow.connect(sender1).claimRefund(1);

      expect(await escrow.getDepositStatus(1)).to.equal(2);
    });

    it("getDepositStatus should return 0 for non-existent deposit", async function () {
      expect(await escrow.getDepositStatus(999)).to.equal(0);
    });
  });
});
