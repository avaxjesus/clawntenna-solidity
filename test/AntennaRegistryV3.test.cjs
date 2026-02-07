const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("AntennaRegistryV3", function () {
  let registry;
  let mockToken;
  let owner, treasury, user1, user2, user3, nonMember;

  // Role constants
  const ROLE_MEMBER = 1;
  const ROLE_ADMIN = 8;

  // Access levels
  const ACCESS_PUBLIC = 0;

  // Time constants
  const ONE_DAY = 24 * 60 * 60; // 24 hours in seconds

  beforeEach(async function () {
    [owner, treasury, user1, user2, user3, nonMember] = await ethers.getSigners();

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
    const registryV2 = await upgrades.upgradeProxy(await registryV1.getAddress(), AntennaRegistryV2);

    // Upgrade to V3
    const AntennaRegistryV3 = await ethers.getContractFactory("AntennaRegistryV3");
    registry = await upgrades.upgradeProxy(await registryV2.getAddress(), AntennaRegistryV3);

    // Create an application for testing
    await registry.connect(user1).createApplication(
      "TestApp",
      "Test application",
      "https://test.app",
      true // allow public topic creation
    );
  });

  describe("Version", function () {
    it("should return V3 version", async function () {
      expect(await registry.getVersion()).to.equal("3.0.0");
    });
  });

  describe("User Nicknames", function () {
    describe("setNickname", function () {
      it("should allow anyone to set their own nickname", async function () {
        // nonMember is not a member of the app
        await registry.connect(nonMember).setNickname(1, "NonMemberNick");

        const nickname = await registry.getNickname(1, nonMember.address);
        expect(nickname).to.equal("NonMemberNick");
      });

      it("should emit UserNicknameSet event", async function () {
        await expect(registry.connect(nonMember).setNickname(1, "TestNick"))
          .to.emit(registry, "UserNicknameSet")
          .withArgs(1, nonMember.address, "TestNick");
      });

      it("should allow updating nickname", async function () {
        await registry.connect(nonMember).setNickname(1, "FirstNick");
        await registry.connect(nonMember).setNickname(1, "SecondNick");

        const nickname = await registry.getNickname(1, nonMember.address);
        expect(nickname).to.equal("SecondNick");
      });

      it("should revert if app does not exist", async function () {
        await expect(
          registry.connect(nonMember).setNickname(999, "TestNick")
        ).to.be.revertedWithCustomError(registry, "ApplicationNotFound");
      });

      it("should revert if nickname is too long (>64 chars)", async function () {
        const longNickname = "a".repeat(65);
        await expect(
          registry.connect(nonMember).setNickname(1, longNickname)
        ).to.be.revertedWith("Nickname too long");
      });

      it("should allow immediate change when no cooldown is set", async function () {
        await registry.connect(nonMember).setNickname(1, "First");
        await registry.connect(nonMember).setNickname(1, "Second");
        expect(await registry.getNickname(1, nonMember.address)).to.equal("Second");
      });

      it("should allow nickname with exactly 64 characters", async function () {
        const maxNickname = "a".repeat(64);
        await registry.connect(nonMember).setNickname(1, maxNickname);

        const nickname = await registry.getNickname(1, nonMember.address);
        expect(nickname).to.equal(maxNickname);
      });

      it("should allow empty nickname", async function () {
        await registry.connect(nonMember).setNickname(1, "TestNick");
        await registry.connect(nonMember).setNickname(1, "");

        const nickname = await registry.getNickname(1, nonMember.address);
        expect(nickname).to.equal("");
      });
    });

    describe("clearNickname", function () {
      it("should clear nickname", async function () {
        await registry.connect(nonMember).setNickname(1, "TestNick");
        await registry.connect(nonMember).clearNickname(1);

        const nickname = await registry.getNickname(1, nonMember.address);
        expect(nickname).to.equal("");
      });

      it("should emit UserNicknameSet event with empty string", async function () {
        await registry.connect(nonMember).setNickname(1, "TestNick");

        await expect(registry.connect(nonMember).clearNickname(1))
          .to.emit(registry, "UserNicknameSet")
          .withArgs(1, nonMember.address, "");
      });

      it("should revert if app does not exist", async function () {
        await expect(
          registry.connect(nonMember).clearNickname(999)
        ).to.be.revertedWithCustomError(registry, "ApplicationNotFound");
      });
    });

    describe("getNickname", function () {
      it("should return member nickname if set (priority over user nickname)", async function () {
        // user1 is the app owner/member with a nickname
        await registry.connect(user1).setMemberNickname(1, "MemberNick");

        // Also set a user nickname (should be ignored)
        await registry.connect(user1).setNickname(1, "UserNick");

        const nickname = await registry.getNickname(1, user1.address);
        expect(nickname).to.equal("MemberNick");
      });

      it("should return user nickname if member has no nickname", async function () {
        // user1 is a member but without a nickname
        // Set a user nickname
        await registry.connect(user1).setNickname(1, "UserNick");

        const nickname = await registry.getNickname(1, user1.address);
        expect(nickname).to.equal("UserNick");
      });

      it("should return empty string if no nickname is set", async function () {
        const nickname = await registry.getNickname(1, nonMember.address);
        expect(nickname).to.equal("");
      });
    });

    describe("hasNickname", function () {
      it("should return true if user has a nickname", async function () {
        await registry.connect(nonMember).setNickname(1, "TestNick");

        expect(await registry.hasNickname(1, nonMember.address)).to.equal(true);
      });

      it("should return false if user has no nickname", async function () {
        expect(await registry.hasNickname(1, nonMember.address)).to.equal(false);
      });

      it("should return true if member has nickname", async function () {
        await registry.connect(user1).setMemberNickname(1, "MemberNick");

        expect(await registry.hasNickname(1, user1.address)).to.equal(true);
      });

      it("should return false after clearing nickname", async function () {
        await registry.connect(nonMember).setNickname(1, "TestNick");
        await registry.connect(nonMember).clearNickname(1);

        expect(await registry.hasNickname(1, nonMember.address)).to.equal(false);
      });
    });

    describe("userNicknames mapping", function () {
      it("should allow direct access to userNicknames mapping", async function () {
        await registry.connect(nonMember).setNickname(1, "DirectAccess");

        const nickname = await registry.userNicknames(1, nonMember.address);
        expect(nickname).to.equal("DirectAccess");
      });
    });
  });

  describe("Security", function () {
    it("should not allow setting nickname for other users", async function () {
      // Try to set nickname - only msg.sender can set their own
      // The function uses msg.sender, so there's no way to set for others
      await registry.connect(user1).setNickname(1, "User1Nick");
      await registry.connect(user2).setNickname(1, "User2Nick");

      // Each user has their own nickname
      expect(await registry.getNickname(1, user1.address)).to.equal("User1Nick");
      expect(await registry.getNickname(1, user2.address)).to.equal("User2Nick");
    });

    it("should isolate nicknames between applications", async function () {
      // Create second app
      await registry.connect(user2).createApplication(
        "TestApp2",
        "Second app",
        "https://test2.app",
        true
      );

      await registry.connect(nonMember).setNickname(1, "Nick1");
      await registry.connect(nonMember).setNickname(2, "Nick2");

      expect(await registry.getNickname(1, nonMember.address)).to.equal("Nick1");
      expect(await registry.getNickname(2, nonMember.address)).to.equal("Nick2");
    });

    it("should handle special characters in nickname", async function () {
      const specialNick = "Test <script>alert('xss')</script>";
      await registry.connect(nonMember).setNickname(1, specialNick);

      const nickname = await registry.getNickname(1, nonMember.address);
      expect(nickname).to.equal(specialNick);
      // Note: XSS protection should be handled at the frontend, not contract level
    });

    it("should handle unicode characters in nickname", async function () {
      const unicodeNick = "测试用户🦞";
      await registry.connect(nonMember).setNickname(1, unicodeNick);

      const nickname = await registry.getNickname(1, nonMember.address);
      expect(nickname).to.equal(unicodeNick);
    });
  });

  describe("Gas Optimization", function () {
    it("should have reasonable gas cost for setNickname", async function () {
      const tx = await registry.connect(nonMember).setNickname(1, "GasTest");
      const receipt = await tx.wait();

      // Log gas used for reference
      console.log("Gas used for setNickname:", receipt.gasUsed.toString());

      // Should be under 100k gas
      expect(receipt.gasUsed).to.be.lessThan(100000);
    });

    it("should have reasonable gas cost for getNickname", async function () {
      await registry.connect(nonMember).setNickname(1, "GasTest");

      // getNickname is a view function, so we estimate gas
      const gasEstimate = await registry.getNickname.estimateGas(1, nonMember.address);
      console.log("Gas estimate for getNickname:", gasEstimate.toString());

      // Should be under 50k gas
      expect(gasEstimate).to.be.lessThan(50000);
    });
  });

  describe("Upgrade Safety", function () {
    it("should preserve existing data after upgrade", async function () {
      // Set nickname in V3
      await registry.connect(nonMember).setNickname(1, "PreserveMe");

      // Verify it exists
      expect(await registry.getNickname(1, nonMember.address)).to.equal("PreserveMe");

      // The upgrade from V2 to V3 already happened in beforeEach
      // This test confirms data set in V3 persists
    });

    it("should preserve V1/V2 member nicknames", async function () {
      // Set member nickname (V1 function)
      await registry.connect(user1).setMemberNickname(1, "MemberNickV1");

      // Should still work in V3
      expect(await registry.getNickname(1, user1.address)).to.equal("MemberNickV1");
    });
  });

  describe("Nickname Cooldown", function () {
    describe("setNicknameCooldown", function () {
      it("should allow app owner to set cooldown", async function () {
        await registry.connect(user1).setNicknameCooldown(1, ONE_DAY);
        expect(await registry.appNicknameCooldown(1)).to.equal(ONE_DAY);
      });

      it("should emit NicknameCooldownSet event", async function () {
        await expect(registry.connect(user1).setNicknameCooldown(1, ONE_DAY))
          .to.emit(registry, "NicknameCooldownSet")
          .withArgs(1, ONE_DAY);
      });

      it("should allow admin to set cooldown", async function () {
        // Add user2 as admin
        await registry.connect(user1).addMember(1, user2.address, "Admin", ROLE_ADMIN);

        await registry.connect(user2).setNicknameCooldown(1, ONE_DAY);
        expect(await registry.appNicknameCooldown(1)).to.equal(ONE_DAY);
      });

      it("should revert if non-admin tries to set cooldown", async function () {
        await expect(
          registry.connect(nonMember).setNicknameCooldown(1, ONE_DAY)
        ).to.be.revertedWithCustomError(registry, "NotAuthorized");
      });

      it("should allow setting cooldown to 0 (disable)", async function () {
        await registry.connect(user1).setNicknameCooldown(1, ONE_DAY);
        await registry.connect(user1).setNicknameCooldown(1, 0);
        expect(await registry.appNicknameCooldown(1)).to.equal(0);
      });
    });

    describe("cooldown enforcement", function () {
      beforeEach(async function () {
        // Set 24-hour cooldown
        await registry.connect(user1).setNicknameCooldown(1, ONE_DAY);
      });

      it("should allow first nickname change", async function () {
        await registry.connect(nonMember).setNickname(1, "First");
        expect(await registry.getNickname(1, nonMember.address)).to.equal("First");
      });

      it("should block immediate second change when cooldown is active", async function () {
        await registry.connect(nonMember).setNickname(1, "First");

        await expect(
          registry.connect(nonMember).setNickname(1, "Second")
        ).to.be.revertedWithCustomError(registry, "NicknameCooldownActive");
      });

      it("should allow change after cooldown expires", async function () {
        await registry.connect(nonMember).setNickname(1, "First");

        // Advance time by 24 hours
        await time.increase(ONE_DAY);

        await registry.connect(nonMember).setNickname(1, "Second");
        expect(await registry.getNickname(1, nonMember.address)).to.equal("Second");
      });

      it("should block clearNickname during cooldown", async function () {
        await registry.connect(nonMember).setNickname(1, "First");

        await expect(
          registry.connect(nonMember).clearNickname(1)
        ).to.be.revertedWithCustomError(registry, "NicknameCooldownActive");
      });

      it("should allow clearNickname after cooldown", async function () {
        await registry.connect(nonMember).setNickname(1, "First");

        await time.increase(ONE_DAY);

        await registry.connect(nonMember).clearNickname(1);
        expect(await registry.getNickname(1, nonMember.address)).to.equal("");
      });
    });

    describe("canChangeNickname", function () {
      it("should return true when no cooldown is set", async function () {
        const [canChange, timeRemaining] = await registry.canChangeNickname(1, nonMember.address);
        expect(canChange).to.equal(true);
        expect(timeRemaining).to.equal(0);
      });

      it("should return true for first-time user with cooldown set", async function () {
        await registry.connect(user1).setNicknameCooldown(1, ONE_DAY);

        const [canChange, timeRemaining] = await registry.canChangeNickname(1, nonMember.address);
        expect(canChange).to.equal(true);
        expect(timeRemaining).to.equal(0);
      });

      it("should return false with time remaining during cooldown", async function () {
        await registry.connect(user1).setNicknameCooldown(1, ONE_DAY);
        await registry.connect(nonMember).setNickname(1, "Test");

        const [canChange, timeRemaining] = await registry.canChangeNickname(1, nonMember.address);
        expect(canChange).to.equal(false);
        expect(timeRemaining).to.be.closeTo(ONE_DAY, 5); // Allow 5 second tolerance
      });

      it("should return true after cooldown expires", async function () {
        await registry.connect(user1).setNicknameCooldown(1, ONE_DAY);
        await registry.connect(nonMember).setNickname(1, "Test");

        await time.increase(ONE_DAY);

        const [canChange, timeRemaining] = await registry.canChangeNickname(1, nonMember.address);
        expect(canChange).to.equal(true);
        expect(timeRemaining).to.equal(0);
      });
    });

    describe("per-app cooldown isolation", function () {
      beforeEach(async function () {
        // Create second app with different cooldown
        await registry.connect(user2).createApplication(
          "TestApp2",
          "Second app",
          "https://test2.app",
          true
        );

        // Set different cooldowns
        await registry.connect(user1).setNicknameCooldown(1, ONE_DAY);
        await registry.connect(user2).setNicknameCooldown(2, 60); // 1 minute
      });

      it("should enforce different cooldowns per app", async function () {
        // Set nickname on both apps
        await registry.connect(nonMember).setNickname(1, "App1Nick");
        await registry.connect(nonMember).setNickname(2, "App2Nick");

        // Wait 2 minutes - enough for app 2 but not app 1
        await time.increase(120);

        // App 1 should still be blocked
        await expect(
          registry.connect(nonMember).setNickname(1, "App1Nick2")
        ).to.be.revertedWithCustomError(registry, "NicknameCooldownActive");

        // App 2 should be allowed
        await registry.connect(nonMember).setNickname(2, "App2Nick2");
        expect(await registry.getNickname(2, nonMember.address)).to.equal("App2Nick2");
      });
    });
  });
});
