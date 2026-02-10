const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

describe("AntennaRegistryV8", function () {
  let registry;
  let escrow;
  let mockToken;
  let owner, treasury, appOwner, topicOwner, sender1, sender2;

  const ACCESS_PUBLIC = 0;
  const MESSAGE_FEE = ethers.parseEther("1");

  beforeEach(async function () {
    [owner, treasury, appOwner, topicOwner, sender1, sender2] = await ethers.getSigners();

    // Deploy mock ERC20
    const MockToken = await ethers.getContractFactory("MockERC20");
    mockToken = await MockToken.deploy("Mock Token", "MTK", ethers.parseEther("1000000"));
    await mockToken.waitForDeployment();

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
  });

  // ================================================================
  // Version
  // ================================================================

  describe("Version", function () {
    it("should return V8 version", async function () {
      expect(await registry.getVersion()).to.equal("8.0.0");
    });
  });

  // ================================================================
  // Escrow Contract Management
  // ================================================================

  describe("Escrow Contract Management", function () {
    it("should allow owner to set escrow contract", async function () {
      await expect(registry.setEscrowContract(sender1.address))
        .to.emit(registry, "EscrowContractUpdated")
        .withArgs(sender1.address);

      expect(await registry.escrowContract()).to.equal(sender1.address);
    });

    it("should revert when non-owner sets escrow contract", async function () {
      await expect(
        registry.connect(sender1).setEscrowContract(sender1.address)
      ).to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount");
    });

    it("should start with zero escrow contract", async function () {
      expect(await registry.escrowContract()).to.equal(ethers.ZeroAddress);
    });
  });

  // ================================================================
  // Backwards Compatibility
  // ================================================================

  describe("Backwards Compatibility", function () {
    beforeEach(async function () {
      const registryAddress = await registry.getAddress();
      const tokenAddress = await mockToken.getAddress();

      // Setup app and topic
      await registry.connect(appOwner).createApplication("TestApp", "Test", "https://test.app", true);
      await registry.connect(topicOwner).createTopic(1, "TestTopic", "Test", ACCESS_PUBLIC);
      await registry.connect(topicOwner).setTopicMessageFee(1, tokenAddress, MESSAGE_FEE);

      // Fund sender
      await mockToken.transfer(sender1.address, ethers.parseEther("100"));
      await mockToken.connect(sender1).approve(registryAddress, ethers.MaxUint256);
    });

    it("should use V7 direct path when no escrow is set", async function () {
      // No escrow contract set
      const topicOwnerBefore = await mockToken.balanceOf(topicOwner.address);
      await registry.connect(sender1).sendMessage(1, "0x1234");
      const topicOwnerAfter = await mockToken.balanceOf(topicOwner.address);

      const expected90 = (MESSAGE_FEE * 9000n) / 10000n;
      expect(topicOwnerAfter - topicOwnerBefore).to.equal(expected90);
    });

    it("should send messages without fees normally", async function () {
      // Create a topic with no fee
      await registry.connect(topicOwner).createTopic(1, "FreeTopic", "No fees", ACCESS_PUBLIC);

      await expect(registry.connect(sender1).sendMessage(2, "0x1234"))
        .to.emit(registry, "MessageSent");
    });

    it("should create topics normally", async function () {
      await expect(
        registry.connect(sender1).createTopic(1, "NewTopic", "Test", ACCESS_PUBLIC)
      ).to.emit(registry, "TopicCreated");
    });

    it("should preserve existing V7 fee split constants", async function () {
      expect(await registry.PLATFORM_FEE_BPS_V7()).to.equal(500);
      expect(await registry.APP_OWNER_FEE_BPS()).to.equal(500);
    });
  });

  // ================================================================
  // SendMessage Routing Logic
  // ================================================================

  describe("SendMessage Routing", function () {
    let escrowAddress;
    let tokenAddress;
    let registryAddress;

    beforeEach(async function () {
      registryAddress = await registry.getAddress();
      tokenAddress = await mockToken.getAddress();

      // Deploy escrow
      const Escrow = await ethers.getContractFactory("MessageEscrowV1");
      escrow = await upgrades.deployProxy(Escrow, [registryAddress, treasury.address], {
        initializer: "initialize",
        kind: "uups",
      });
      await escrow.waitForDeployment();
      escrowAddress = await escrow.getAddress();

      // Wire up
      await registry.setEscrowContract(escrowAddress);

      // Setup
      await registry.connect(appOwner).createApplication("TestApp", "Test", "https://test.app", true);
      await registry.connect(topicOwner).createTopic(1, "TestTopic", "Test", ACCESS_PUBLIC);
      await registry.connect(topicOwner).setTopicMessageFee(1, tokenAddress, MESSAGE_FEE);

      await mockToken.transfer(sender1.address, ethers.parseEther("100"));
      await mockToken.connect(sender1).approve(registryAddress, ethers.MaxUint256);
    });

    it("should route to escrow when enabled", async function () {
      await escrow.connect(topicOwner).enableEscrow(1, 3600);

      await registry.connect(sender1).sendMessage(1, "0x1234");

      const escrowBal = await mockToken.balanceOf(escrowAddress);
      expect(escrowBal).to.equal(MESSAGE_FEE);
    });

    it("should route to V7 direct path when escrow not enabled for topic", async function () {
      // Escrow contract is set, but not enabled for this topic
      const topicOwnerBefore = await mockToken.balanceOf(topicOwner.address);
      await registry.connect(sender1).sendMessage(1, "0x1234");
      const topicOwnerAfter = await mockToken.balanceOf(topicOwner.address);

      const expected90 = (MESSAGE_FEE * 9000n) / 10000n;
      expect(topicOwnerAfter - topicOwnerBefore).to.equal(expected90);
    });

    it("should trigger release when topic owner sends message", async function () {
      await escrow.connect(topicOwner).enableEscrow(1, 3600);
      await registry.connect(sender1).sendMessage(1, "0x1234");

      const topicOwnerBefore = await mockToken.balanceOf(topicOwner.address);
      await registry.connect(topicOwner).sendMessage(1, "0xaa01");
      const topicOwnerAfter = await mockToken.balanceOf(topicOwner.address);

      const expected90 = (MESSAGE_FEE * 9000n) / 10000n;
      expect(topicOwnerAfter - topicOwnerBefore).to.equal(expected90);
    });

    it("should not trigger release when non-owner sends message", async function () {
      await escrow.connect(topicOwner).enableEscrow(1, 3600);
      await registry.connect(sender1).sendMessage(1, "0x1234");

      // sender2 sends — should not trigger release
      await mockToken.transfer(sender2.address, ethers.parseEther("10"));
      await mockToken.connect(sender2).approve(registryAddress, ethers.MaxUint256);
      await registry.connect(sender2).sendMessage(1, "0x5678");

      // Both deposits should still be pending
      const pending = await escrow.getPendingDeposits(1);
      expect(pending.length).to.equal(2);
    });
  });

  // ================================================================
  // Upgrade Safety
  // ================================================================

  describe("Upgrade Safety", function () {
    it("should preserve state after upgrade from V7 to V8", async function () {
      const registryAddress = await registry.getAddress();
      const tokenAddress = await mockToken.getAddress();

      // Create data on V7
      await registry.connect(appOwner).createApplication("UpgradeApp", "Test", "https://test.app", true);
      await registry.connect(topicOwner).createTopic(1, "UpgradeTopic", "Test", ACCESS_PUBLIC);

      // Verify data persists
      const topic = await registry.topics(1);
      expect(topic.owner).to.equal(topicOwner.address);

      const app = await registry.applications(1);
      expect(app.owner).to.equal(appOwner.address);
    });
  });
});
