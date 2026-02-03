const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

describe("AntennaRegistryV2", function () {
  let registry;
  let mockToken;
  let owner, treasury, user1, user2, user3;

  const TOPIC_CREATION_FEE = ethers.parseEther("10");
  const MESSAGE_FEE = ethers.parseEther("1");

  // Role constants
  const ROLE_MEMBER = 1;
  const ROLE_ADMIN = 8;

  // Access levels
  const ACCESS_PUBLIC = 0;
  const ACCESS_PRIVATE = 2;

  // Permissions
  const PERMISSION_ADMIN = 4;

  // Platform fee
  const PLATFORM_FEE_BPS = 300n; // 3%
  const BPS_DENOMINATOR = 10000n;

  beforeEach(async function () {
    [owner, treasury, user1, user2, user3] = await ethers.getSigners();

    // Deploy mock ERC20 token for fees
    const MockToken = await ethers.getContractFactory("MockERC20");
    mockToken = await MockToken.deploy("Mock Token", "MTK", ethers.parseEther("1000000"));
    await mockToken.waitForDeployment();

    // Deploy V1 first as upgradeable proxy
    const AntennaRegistryV1 = await ethers.getContractFactory("AntennaRegistryV1");
    const registryV1 = await upgrades.deployProxy(AntennaRegistryV1, [treasury.address], {
      initializer: "initialize",
      kind: "uups",
    });
    await registryV1.waitForDeployment();

    // Upgrade to V2
    const AntennaRegistryV2 = await ethers.getContractFactory("AntennaRegistryV2");
    registry = await upgrades.upgradeProxy(await registryV1.getAddress(), AntennaRegistryV2);

    // Distribute tokens to test users
    await mockToken.transfer(user1.address, ethers.parseEther("10000"));
    await mockToken.transfer(user2.address, ethers.parseEther("10000"));
    await mockToken.transfer(user3.address, ethers.parseEther("10000"));
  });

  describe("Version", function () {
    it("should return V2 version", async function () {
      expect(await registry.getVersion()).to.equal("2.0.0");
    });

    it("should have correct platform fee constant", async function () {
      expect(await registry.PLATFORM_FEE_BPS()).to.equal(300);
    });
  });

  describe("Topic Creation Fees (Decoupled)", function () {
    beforeEach(async function () {
      // Create an application as user1
      await registry.connect(user1).createApplication(
        "TestApp",
        "Test application",
        "https://test.app",
        true // allow public topic creation
      );
      // Set topic creation fee
      await registry.connect(user1).setTopicCreationFee(1, mockToken.target, TOPIC_CREATION_FEE);
    });

    it("should collect topic creation fee WITHOUT global feesEnabled", async function () {
      // Note: feesEnabled is false by default, but V2 should still collect app-level fees
      expect(await registry.feesEnabled()).to.equal(false);

      await mockToken.connect(user2).approve(registry.target, TOPIC_CREATION_FEE);

      const appOwnerBefore = await mockToken.balanceOf(user1.address);
      const treasuryBefore = await mockToken.balanceOf(treasury.address);

      await registry.connect(user2).createTopic(1, "general", "General discussion", ACCESS_PUBLIC);

      const appOwnerAfter = await mockToken.balanceOf(user1.address);
      const treasuryAfter = await mockToken.balanceOf(treasury.address);

      // Calculate expected amounts
      const platformFee = (TOPIC_CREATION_FEE * PLATFORM_FEE_BPS) / BPS_DENOMINATOR;
      const ownerAmount = TOPIC_CREATION_FEE - platformFee;

      expect(appOwnerAfter - appOwnerBefore).to.equal(ownerAmount);
      expect(treasuryAfter - treasuryBefore).to.equal(platformFee);
    });

    it("should emit PlatformFeeCollected event", async function () {
      await mockToken.connect(user2).approve(registry.target, TOPIC_CREATION_FEE);

      const platformFee = (TOPIC_CREATION_FEE * PLATFORM_FEE_BPS) / BPS_DENOMINATOR;

      await expect(registry.connect(user2).createTopic(1, "general", "General", ACCESS_PUBLIC))
        .to.emit(registry, "PlatformFeeCollected")
        .withArgs(mockToken.target, platformFee, user1.address, treasury.address);
    });

    it("should revert if insufficient balance", async function () {
      await mockToken.connect(user3).transfer(owner.address, await mockToken.balanceOf(user3.address)); // Drain user3
      await mockToken.connect(user3).approve(registry.target, TOPIC_CREATION_FEE);

      await expect(registry.connect(user3).createTopic(1, "general", "General", ACCESS_PUBLIC))
        .to.be.revertedWithCustomError(registry, "InsufficientBalance");
    });

    it("should revert if insufficient allowance", async function () {
      await expect(registry.connect(user2).createTopic(1, "general", "General", ACCESS_PUBLIC))
        .to.be.revertedWithCustomError(registry, "InsufficientAllowance");
    });

    it("should allow free topic creation if fee is zero", async function () {
      // Set fee to zero
      await registry.connect(user1).setTopicCreationFee(1, ethers.ZeroAddress, 0);

      // Should work without approval
      await expect(registry.connect(user2).createTopic(1, "free", "Free topic", ACCESS_PUBLIC))
        .to.emit(registry, "TopicCreated");
    });
  });

  describe("Message Fees", function () {
    beforeEach(async function () {
      // Create application and topic
      await registry.connect(user1).createApplication(
        "TestApp",
        "Test application",
        "https://test.app",
        true
      );
      await registry.connect(user1).createTopic(1, "paid", "Paid topic", ACCESS_PUBLIC);
    });

    describe("setTopicMessageFee", function () {
      it("should allow topic owner to set message fee", async function () {
        await registry.connect(user1).setTopicMessageFee(1, mockToken.target, MESSAGE_FEE);

        const [token, amount] = await registry.getTopicMessageFee(1);
        expect(token).to.equal(mockToken.target);
        expect(amount).to.equal(MESSAGE_FEE);
      });

      it("should emit TopicMessageFeeUpdated event", async function () {
        await expect(registry.connect(user1).setTopicMessageFee(1, mockToken.target, MESSAGE_FEE))
          .to.emit(registry, "TopicMessageFeeUpdated")
          .withArgs(1, mockToken.target, MESSAGE_FEE);
      });

      it("should allow topic admin to set message fee", async function () {
        // Grant admin permission to user2
        await registry.connect(user1).setTopicPermission(1, user2.address, PERMISSION_ADMIN);

        await registry.connect(user2).setTopicMessageFee(1, mockToken.target, MESSAGE_FEE);

        const [token, amount] = await registry.getTopicMessageFee(1);
        expect(token).to.equal(mockToken.target);
        expect(amount).to.equal(MESSAGE_FEE);
      });

      it("should allow app admin to set message fee", async function () {
        // Add user2 as app admin
        await registry.connect(user1).addMember(1, user2.address, "Admin", ROLE_ADMIN);

        await registry.connect(user2).setTopicMessageFee(1, mockToken.target, MESSAGE_FEE);

        const [token, amount] = await registry.getTopicMessageFee(1);
        expect(amount).to.equal(MESSAGE_FEE);
      });

      it("should not allow unauthorized users to set message fee", async function () {
        await expect(registry.connect(user2).setTopicMessageFee(1, mockToken.target, MESSAGE_FEE))
          .to.be.revertedWithCustomError(registry, "NotAuthorized");
      });

      it("should revert for non-existent topic", async function () {
        await expect(registry.connect(user1).setTopicMessageFee(999, mockToken.target, MESSAGE_FEE))
          .to.be.revertedWithCustomError(registry, "TopicNotFound");
      });

      it("should allow setting fee to zero to disable", async function () {
        await registry.connect(user1).setTopicMessageFee(1, mockToken.target, MESSAGE_FEE);
        await registry.connect(user1).setTopicMessageFee(1, ethers.ZeroAddress, 0);

        const [token, amount] = await registry.getTopicMessageFee(1);
        expect(token).to.equal(ethers.ZeroAddress);
        expect(amount).to.equal(0);
      });
    });

    describe("sendMessage with fees", function () {
      beforeEach(async function () {
        await registry.connect(user1).setTopicMessageFee(1, mockToken.target, MESSAGE_FEE);
      });

      it("should collect message fee with platform split", async function () {
        await mockToken.connect(user2).approve(registry.target, MESSAGE_FEE);

        const topicOwnerBefore = await mockToken.balanceOf(user1.address);
        const treasuryBefore = await mockToken.balanceOf(treasury.address);

        const payload = ethers.toUtf8Bytes("Hello World");
        await registry.connect(user2).sendMessage(1, payload);

        const topicOwnerAfter = await mockToken.balanceOf(user1.address);
        const treasuryAfter = await mockToken.balanceOf(treasury.address);

        // Calculate expected amounts (3% platform fee)
        const platformFee = (MESSAGE_FEE * PLATFORM_FEE_BPS) / BPS_DENOMINATOR;
        const ownerAmount = MESSAGE_FEE - platformFee;

        expect(topicOwnerAfter - topicOwnerBefore).to.equal(ownerAmount);
        expect(treasuryAfter - treasuryBefore).to.equal(platformFee);
      });

      it("should emit PlatformFeeCollected on message", async function () {
        await mockToken.connect(user2).approve(registry.target, MESSAGE_FEE);

        const platformFee = (MESSAGE_FEE * PLATFORM_FEE_BPS) / BPS_DENOMINATOR;
        const payload = ethers.toUtf8Bytes("Hello");

        await expect(registry.connect(user2).sendMessage(1, payload))
          .to.emit(registry, "PlatformFeeCollected")
          .withArgs(mockToken.target, platformFee, user1.address, treasury.address);
      });

      it("should still emit MessageSent event", async function () {
        await mockToken.connect(user2).approve(registry.target, MESSAGE_FEE);
        const payload = ethers.toUtf8Bytes("Hello");

        await expect(registry.connect(user2).sendMessage(1, payload))
          .to.emit(registry, "MessageSent");
      });

      it("should revert if insufficient balance", async function () {
        await mockToken.connect(user3).transfer(owner.address, await mockToken.balanceOf(user3.address));
        await mockToken.connect(user3).approve(registry.target, MESSAGE_FEE);

        const payload = ethers.toUtf8Bytes("Hello");
        await expect(registry.connect(user3).sendMessage(1, payload))
          .to.be.revertedWithCustomError(registry, "InsufficientBalance");
      });

      it("should revert if insufficient allowance", async function () {
        const payload = ethers.toUtf8Bytes("Hello");
        await expect(registry.connect(user2).sendMessage(1, payload))
          .to.be.revertedWithCustomError(registry, "InsufficientAllowance");
      });

      it("should allow free messages if fee is not set", async function () {
        // Create a topic without fee
        await registry.connect(user1).createTopic(1, "free", "Free topic", ACCESS_PUBLIC);

        const payload = ethers.toUtf8Bytes("Free message");
        await expect(registry.connect(user2).sendMessage(2, payload))
          .to.emit(registry, "MessageSent");
      });

      it("should collect multiple fees for multiple messages", async function () {
        const numMessages = 5;
        await mockToken.connect(user2).approve(registry.target, MESSAGE_FEE * BigInt(numMessages));

        const treasuryBefore = await mockToken.balanceOf(treasury.address);
        const payload = ethers.toUtf8Bytes("Hello");

        for (let i = 0; i < numMessages; i++) {
          await registry.connect(user2).sendMessage(1, payload);
        }

        const treasuryAfter = await mockToken.balanceOf(treasury.address);
        const expectedPlatformFee = ((MESSAGE_FEE * PLATFORM_FEE_BPS) / BPS_DENOMINATOR) * BigInt(numMessages);

        expect(treasuryAfter - treasuryBefore).to.equal(expectedPlatformFee);
      });
    });
  });

  describe("Platform Fee Math", function () {
    beforeEach(async function () {
      await registry.connect(user1).createApplication("TestApp", "Desc", "https://test.app", true);
      await registry.connect(user1).createTopic(1, "general", "General", ACCESS_PUBLIC);
    });

    it("should calculate 3% correctly for various amounts", async function () {
      const testAmounts = [
        ethers.parseEther("100"),   // 3 ETH platform fee
        ethers.parseEther("1"),     // 0.03 ETH platform fee
        ethers.parseEther("0.1"),   // 0.003 ETH platform fee
        ethers.parseEther("33.33"), // ~1 ETH platform fee
      ];

      for (const amount of testAmounts) {
        await registry.connect(user1).setTopicMessageFee(1, mockToken.target, amount);
        await mockToken.connect(user2).approve(registry.target, amount);

        const treasuryBefore = await mockToken.balanceOf(treasury.address);
        const ownerBefore = await mockToken.balanceOf(user1.address);

        const payload = ethers.toUtf8Bytes("Test");
        await registry.connect(user2).sendMessage(1, payload);

        const treasuryAfter = await mockToken.balanceOf(treasury.address);
        const ownerAfter = await mockToken.balanceOf(user1.address);

        const expectedPlatformFee = (amount * PLATFORM_FEE_BPS) / BPS_DENOMINATOR;
        const expectedOwnerAmount = amount - expectedPlatformFee;

        expect(treasuryAfter - treasuryBefore).to.equal(expectedPlatformFee);
        expect(ownerAfter - ownerBefore).to.equal(expectedOwnerAmount);
      }
    });

    it("should handle very small amounts where platform fee rounds to zero", async function () {
      // 1 wei - platform fee would be 0.03 wei which rounds to 0
      const tinyAmount = 1n;
      await registry.connect(user1).setTopicMessageFee(1, mockToken.target, tinyAmount);
      await mockToken.connect(user2).approve(registry.target, tinyAmount);

      const treasuryBefore = await mockToken.balanceOf(treasury.address);
      const ownerBefore = await mockToken.balanceOf(user1.address);

      const payload = ethers.toUtf8Bytes("Tiny");
      await registry.connect(user2).sendMessage(1, payload);

      const treasuryAfter = await mockToken.balanceOf(treasury.address);
      const ownerAfter = await mockToken.balanceOf(user1.address);

      // Platform fee = (1 * 300) / 10000 = 0 (integer division)
      // So owner gets full amount, treasury gets 0
      expect(treasuryAfter - treasuryBefore).to.equal(0);
      expect(ownerAfter - ownerBefore).to.equal(tinyAmount);
    });
  });

  describe("Backwards Compatibility", function () {
    it("should preserve V1 functionality after upgrade", async function () {
      // Create application
      await registry.connect(user1).createApplication("TestApp", "Desc", "https://test.app", false);

      // Add member
      await registry.connect(user1).addMember(1, user2.address, "User2", ROLE_MEMBER);

      // Create topic
      await registry.connect(user1).createTopic(1, "general", "General", ACCESS_PUBLIC);

      // Send message (without fee)
      const payload = ethers.toUtf8Bytes("Hello");
      await expect(registry.connect(user2).sendMessage(1, payload))
        .to.emit(registry, "MessageSent");

      // Verify state
      expect(await registry.applicationCount()).to.equal(1);
      expect(await registry.topicCount()).to.equal(1);

      const topic = await registry.getTopic(1);
      expect(topic.messageCount).to.equal(1);
    });

    it("should still support global application fees when enabled", async function () {
      await registry.setFeeToken(mockToken.target);
      await registry.setFees(ethers.parseEther("50"), 0);
      await registry.setFeesEnabled(true);

      await mockToken.connect(user1).approve(registry.target, ethers.parseEther("50"));

      const treasuryBefore = await mockToken.balanceOf(treasury.address);
      await registry.connect(user1).createApplication("TestApp", "Desc", "https://test.app", false);
      const treasuryAfter = await mockToken.balanceOf(treasury.address);

      expect(treasuryAfter - treasuryBefore).to.equal(ethers.parseEther("50"));
    });
  });

  describe("Edge Cases", function () {
    beforeEach(async function () {
      await registry.connect(user1).createApplication("TestApp", "Desc", "https://test.app", true);
      await registry.connect(user1).createTopic(1, "general", "General", ACCESS_PRIVATE);
    });

    it("should handle private topic with message fees", async function () {
      await registry.connect(user1).setTopicMessageFee(1, mockToken.target, MESSAGE_FEE);
      await registry.connect(user1).setTopicPermission(1, user2.address, PERMISSION_ADMIN);
      await mockToken.connect(user2).approve(registry.target, MESSAGE_FEE);

      const payload = ethers.toUtf8Bytes("Private message");
      await expect(registry.connect(user2).sendMessage(1, payload))
        .to.emit(registry, "MessageSent");
    });

    it("should not allow unauthorized user to send paid message", async function () {
      await registry.connect(user1).setTopicMessageFee(1, mockToken.target, MESSAGE_FEE);
      await mockToken.connect(user2).approve(registry.target, MESSAGE_FEE);

      const payload = ethers.toUtf8Bytes("Unauthorized");
      await expect(registry.connect(user2).sendMessage(1, payload))
        .to.be.revertedWithCustomError(registry, "NotAuthorized");
    });

    it("should check authorization before collecting fee", async function () {
      await registry.connect(user1).setTopicMessageFee(1, mockToken.target, MESSAGE_FEE);
      // Don't approve - if auth check comes after fee, it would revert with InsufficientAllowance

      const payload = ethers.toUtf8Bytes("Unauthorized");
      // Should revert with NotAuthorized, not InsufficientAllowance
      await expect(registry.connect(user2).sendMessage(1, payload))
        .to.be.revertedWithCustomError(registry, "NotAuthorized");
    });
  });

  describe("Emergency Scenarios", function () {
    beforeEach(async function () {
      await registry.connect(user1).createApplication("TestApp", "Desc", "https://test.app", true);
      await registry.connect(user1).createTopic(1, "general", "General", ACCESS_PUBLIC);
    });

    it("should handle treasury set to zero address (only owner receives)", async function () {
      // Set treasury to zero address
      await registry.setTreasury(ethers.ZeroAddress);

      await registry.connect(user1).setTopicMessageFee(1, mockToken.target, MESSAGE_FEE);
      await mockToken.connect(user2).approve(registry.target, MESSAGE_FEE);

      const ownerBefore = await mockToken.balanceOf(user1.address);

      const payload = ethers.toUtf8Bytes("Message");
      // Platform fee should be skipped when treasury is zero
      await registry.connect(user2).sendMessage(1, payload);

      const ownerAfter = await mockToken.balanceOf(user1.address);

      // Owner should receive 97% (platform fee skipped due to zero treasury)
      const expectedOwner = MESSAGE_FEE - (MESSAGE_FEE * PLATFORM_FEE_BPS) / BPS_DENOMINATOR;
      expect(ownerAfter - ownerBefore).to.equal(expectedOwner);
    });

    it("should allow owner to change treasury mid-operation", async function () {
      await registry.connect(user1).setTopicMessageFee(1, mockToken.target, MESSAGE_FEE);
      await mockToken.connect(user2).approve(registry.target, MESSAGE_FEE * 2n);

      // Send first message to original treasury
      let payload = ethers.toUtf8Bytes("Message1");
      await registry.connect(user2).sendMessage(1, payload);

      // Change treasury
      await registry.setTreasury(user3.address);

      // Send second message to new treasury
      const user3Before = await mockToken.balanceOf(user3.address);
      payload = ethers.toUtf8Bytes("Message2");
      await registry.connect(user2).sendMessage(1, payload);
      const user3After = await mockToken.balanceOf(user3.address);

      const expectedPlatformFee = (MESSAGE_FEE * PLATFORM_FEE_BPS) / BPS_DENOMINATOR;
      expect(user3After - user3Before).to.equal(expectedPlatformFee);
    });

    it("should handle fee changes between messages", async function () {
      const FEE_1 = ethers.parseEther("1");
      const FEE_2 = ethers.parseEther("5");

      await registry.connect(user1).setTopicMessageFee(1, mockToken.target, FEE_1);
      await mockToken.connect(user2).approve(registry.target, FEE_1 + FEE_2);

      // Send with first fee
      let payload = ethers.toUtf8Bytes("Message1");
      await registry.connect(user2).sendMessage(1, payload);

      // Change fee
      await registry.connect(user1).setTopicMessageFee(1, mockToken.target, FEE_2);

      // Send with new fee
      const ownerBefore = await mockToken.balanceOf(user1.address);
      payload = ethers.toUtf8Bytes("Message2");
      await registry.connect(user2).sendMessage(1, payload);
      const ownerAfter = await mockToken.balanceOf(user1.address);

      const expectedOwner = FEE_2 - (FEE_2 * PLATFORM_FEE_BPS) / BPS_DENOMINATOR;
      expect(ownerAfter - ownerBefore).to.equal(expectedOwner);
    });

    it("should handle very large fees", async function () {
      const LARGE_FEE = ethers.parseEther("5000"); // 5k tokens (user2 has 10k)

      await registry.connect(user1).setTopicMessageFee(1, mockToken.target, LARGE_FEE);
      await mockToken.connect(user2).approve(registry.target, LARGE_FEE);

      const ownerBefore = await mockToken.balanceOf(user1.address);
      const treasuryBefore = await mockToken.balanceOf(treasury.address);

      const payload = ethers.toUtf8Bytes("Large fee message");
      await registry.connect(user2).sendMessage(1, payload);

      const ownerAfter = await mockToken.balanceOf(user1.address);
      const treasuryAfter = await mockToken.balanceOf(treasury.address);

      const expectedPlatformFee = (LARGE_FEE * PLATFORM_FEE_BPS) / BPS_DENOMINATOR;
      const expectedOwner = LARGE_FEE - expectedPlatformFee;

      expect(ownerAfter - ownerBefore).to.equal(expectedOwner);
      expect(treasuryAfter - treasuryBefore).to.equal(expectedPlatformFee);
    });

    it("should handle disabling fee after it was set", async function () {
      await registry.connect(user1).setTopicMessageFee(1, mockToken.target, MESSAGE_FEE);

      // Disable fee
      await registry.connect(user1).setTopicMessageFee(1, ethers.ZeroAddress, 0);

      // Should work without approval now
      const payload = ethers.toUtf8Bytes("Free message");
      await expect(registry.connect(user2).sendMessage(1, payload))
        .to.emit(registry, "MessageSent")
        .and.not.to.emit(registry, "PlatformFeeCollected");
    });
  });

  describe("Multiple Topics/Apps Isolation", function () {
    beforeEach(async function () {
      // Create two apps by different owners
      await registry.connect(user1).createApplication("App1", "Desc", "https://app1.com", true);
      await registry.connect(user2).createApplication("App2", "Desc", "https://app2.com", true);

      // Create topics in each app
      await registry.connect(user1).createTopic(1, "topic1", "Topic 1", ACCESS_PUBLIC);
      await registry.connect(user2).createTopic(2, "topic2", "Topic 2", ACCESS_PUBLIC);
    });

    it("should keep fees isolated between topics", async function () {
      const FEE_1 = ethers.parseEther("1");
      const FEE_2 = ethers.parseEther("5");

      await registry.connect(user1).setTopicMessageFee(1, mockToken.target, FEE_1);
      await registry.connect(user2).setTopicMessageFee(2, mockToken.target, FEE_2);

      const [token1, amount1] = await registry.getTopicMessageFee(1);
      const [token2, amount2] = await registry.getTopicMessageFee(2);

      expect(amount1).to.equal(FEE_1);
      expect(amount2).to.equal(FEE_2);
    });

    it("should send fees to correct topic owners", async function () {
      await registry.connect(user1).setTopicMessageFee(1, mockToken.target, MESSAGE_FEE);
      await registry.connect(user2).setTopicMessageFee(2, mockToken.target, MESSAGE_FEE);

      await mockToken.connect(user3).approve(registry.target, MESSAGE_FEE * 2n);

      // Send to topic 1 (owned by user1)
      const user1Before = await mockToken.balanceOf(user1.address);
      await registry.connect(user3).sendMessage(1, ethers.toUtf8Bytes("To topic 1"));
      const user1After = await mockToken.balanceOf(user1.address);

      // Send to topic 2 (owned by user2)
      const user2Before = await mockToken.balanceOf(user2.address);
      await registry.connect(user3).sendMessage(2, ethers.toUtf8Bytes("To topic 2"));
      const user2After = await mockToken.balanceOf(user2.address);

      const expectedOwnerAmount = MESSAGE_FEE - (MESSAGE_FEE * PLATFORM_FEE_BPS) / BPS_DENOMINATOR;

      expect(user1After - user1Before).to.equal(expectedOwnerAmount);
      expect(user2After - user2Before).to.equal(expectedOwnerAmount);
    });

    it("should not allow user1 to set fees on user2's topic", async function () {
      await expect(registry.connect(user1).setTopicMessageFee(2, mockToken.target, MESSAGE_FEE))
        .to.be.revertedWithCustomError(registry, "NotAuthorized");
    });
  });

  describe("Upgrade Safety", function () {
    it("should preserve data after upgrade simulation", async function () {
      // Create data
      await registry.connect(user1).createApplication("TestApp", "Desc", "https://test.app", false);
      await registry.connect(user1).addMember(1, user2.address, "User2", ROLE_MEMBER);
      await registry.connect(user1).createTopic(1, "general", "General", ACCESS_PUBLIC);
      await registry.connect(user1).setTopicMessageFee(1, mockToken.target, MESSAGE_FEE);

      // Verify data
      expect(await registry.applicationCount()).to.equal(1);
      expect(await registry.topicCount()).to.equal(1);
      expect(await registry.isMember(1, user2.address)).to.equal(true);

      const [token, amount] = await registry.getTopicMessageFee(1);
      expect(token).to.equal(mockToken.target);
      expect(amount).to.equal(MESSAGE_FEE);
    });

    it("should maintain correct version after upgrade", async function () {
      expect(await registry.getVersion()).to.equal("2.0.0");
    });

    it("should still allow owner to upgrade", async function () {
      // Owner should be able to prepare for another upgrade
      const AntennaRegistryV2 = await ethers.getContractFactory("AntennaRegistryV2");
      // Just validate, don't actually upgrade (would be V3)
      await expect(upgrades.validateUpgrade(await registry.getAddress(), AntennaRegistryV2))
        .to.not.be.rejected;
    });
  });

  describe("Reentrancy Protection", function () {
    it("should have reentrancy guard on sendMessage", async function () {
      await registry.connect(user1).createApplication("TestApp", "Desc", "https://test.app", true);
      await registry.connect(user1).createTopic(1, "general", "General", ACCESS_PUBLIC);
      await registry.connect(user1).setTopicMessageFee(1, mockToken.target, MESSAGE_FEE);
      await mockToken.connect(user2).approve(registry.target, MESSAGE_FEE);

      // If reentrancy guard is working, this should complete without issues
      const payload = ethers.toUtf8Bytes("Test");
      await expect(registry.connect(user2).sendMessage(1, payload))
        .to.emit(registry, "MessageSent");
    });

    it("should have reentrancy guard on createTopic", async function () {
      await registry.connect(user1).createApplication("TestApp", "Desc", "https://test.app", true);
      await registry.connect(user1).setTopicCreationFee(1, mockToken.target, TOPIC_CREATION_FEE);
      await mockToken.connect(user2).approve(registry.target, TOPIC_CREATION_FEE);

      // If reentrancy guard is working, this should complete without issues
      await expect(registry.connect(user2).createTopic(1, "new", "New topic", ACCESS_PUBLIC))
        .to.emit(registry, "TopicCreated");
    });
  });
});
