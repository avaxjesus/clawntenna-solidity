const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

describe("AntennaRegistryV5", function () {
  let registry;
  let mockToken;
  let mockERC721;
  let owner, treasury, user1, user2, user3;

  // Role constants
  const ROLE_MEMBER = 1;
  const ROLE_ADMIN = 8;

  // Access levels
  const ACCESS_PUBLIC = 0;

  beforeEach(async function () {
    [owner, treasury, user1, user2, user3] = await ethers.getSigners();

    // Deploy mock ERC20 token for fees
    const MockToken = await ethers.getContractFactory("MockERC20");
    mockToken = await MockToken.deploy("Mock Token", "MTK", ethers.parseEther("1000000"));
    await mockToken.waitForDeployment();

    // Deploy mock ERC721 as identity registry
    const MockERC721 = await ethers.getContractFactory("MockERC721");
    mockERC721 = await MockERC721.deploy();
    await mockERC721.waitForDeployment();

    // Deploy V1 first as upgradeable proxy
    const AntennaRegistryV1 = await ethers.getContractFactory("AntennaRegistryV1");
    const registryV1 = await upgrades.deployProxy(AntennaRegistryV1, [treasury.address], {
      initializer: "initialize",
      kind: "uups",
    });
    await registryV1.waitForDeployment();

    // Upgrade through V2 → V3 → V4 → V5
    const AntennaRegistryV2 = await ethers.getContractFactory("AntennaRegistryV2");
    const registryV2 = await upgrades.upgradeProxy(await registryV1.getAddress(), AntennaRegistryV2);

    const AntennaRegistryV3 = await ethers.getContractFactory("AntennaRegistryV3");
    const registryV3 = await upgrades.upgradeProxy(await registryV2.getAddress(), AntennaRegistryV3);

    const AntennaRegistryV4 = await ethers.getContractFactory("AntennaRegistryV4");
    const registryV4 = await upgrades.upgradeProxy(await registryV3.getAddress(), AntennaRegistryV4);

    const AntennaRegistryV5 = await ethers.getContractFactory("AntennaRegistryV5");
    registry = await upgrades.upgradeProxy(await registryV4.getAddress(), AntennaRegistryV5);

    // Create an application for testing
    await registry.connect(user1).createApplication(
      "TestApp",
      "Test application",
      "https://test.app",
      true // allow public topic creation
    );
  });

  describe("Version", function () {
    it("should return V5 version", async function () {
      expect(await registry.getVersion()).to.equal("5.0.0");
    });
  });

  describe("setIdentityRegistryAddress", function () {
    it("should allow owner to set identity registry address", async function () {
      const addr = await mockERC721.getAddress();
      await expect(registry.setIdentityRegistryAddress(addr))
        .to.emit(registry, "IdentityRegistryAddressUpdated")
        .withArgs(addr);

      expect(await registry.identityRegistryAddress()).to.equal(addr);
    });

    it("should revert when non-owner calls setIdentityRegistryAddress", async function () {
      const addr = await mockERC721.getAddress();
      await expect(
        registry.connect(user1).setIdentityRegistryAddress(addr)
      ).to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount");
    });
  });

  describe("registerAgentIdentity", function () {
    beforeEach(async function () {
      // Set identity registry
      await registry.setIdentityRegistryAddress(await mockERC721.getAddress());
      // Mint token to user1
      await mockERC721.mint(user1.address, 42);
    });

    it("should register when caller owns the token", async function () {
      await expect(registry.connect(user1).registerAgentIdentity(1, 42))
        .to.emit(registry, "AgentIdentityRegistered")
        .withArgs(1, user1.address, 42);

      expect(await registry.getAgentTokenId(1, user1.address)).to.equal(42);
      expect(await registry.hasAgentIdentity(1, user1.address)).to.be.true;
    });

    it("should revert with NotTokenOwner when caller doesn't own token", async function () {
      await expect(
        registry.connect(user2).registerAgentIdentity(1, 42)
      ).to.be.revertedWithCustomError(registry, "NotTokenOwner");
    });

    it("should revert with InvalidTokenId for tokenId 0", async function () {
      await expect(
        registry.connect(user1).registerAgentIdentity(1, 0)
      ).to.be.revertedWithCustomError(registry, "InvalidTokenId");
    });

    it("should revert with ApplicationNotFound for bad appId", async function () {
      await expect(
        registry.connect(user1).registerAgentIdentity(999, 42)
      ).to.be.revertedWithCustomError(registry, "ApplicationNotFound");
    });

    it("should revert with IdentityRegistryNotSet when not configured", async function () {
      // Deploy fresh V5 without setting identity registry
      const AntennaRegistryV1 = await ethers.getContractFactory("AntennaRegistryV1");
      const freshV1 = await upgrades.deployProxy(AntennaRegistryV1, [treasury.address], {
        initializer: "initialize",
        kind: "uups",
      });
      await freshV1.waitForDeployment();

      const AntennaRegistryV2 = await ethers.getContractFactory("AntennaRegistryV2");
      const freshV2 = await upgrades.upgradeProxy(await freshV1.getAddress(), AntennaRegistryV2);
      const AntennaRegistryV3 = await ethers.getContractFactory("AntennaRegistryV3");
      const freshV3 = await upgrades.upgradeProxy(await freshV2.getAddress(), AntennaRegistryV3);
      const AntennaRegistryV4 = await ethers.getContractFactory("AntennaRegistryV4");
      const freshV4 = await upgrades.upgradeProxy(await freshV3.getAddress(), AntennaRegistryV4);
      const AntennaRegistryV5 = await ethers.getContractFactory("AntennaRegistryV5");
      const freshRegistry = await upgrades.upgradeProxy(await freshV4.getAddress(), AntennaRegistryV5);

      // Create app
      await freshRegistry.connect(user1).createApplication("App", "desc", "url", true);

      await expect(
        freshRegistry.connect(user1).registerAgentIdentity(1, 42)
      ).to.be.revertedWithCustomError(freshRegistry, "IdentityRegistryNotSet");
    });

    it("should allow overwriting with different tokenId", async function () {
      // Register with token 42
      await registry.connect(user1).registerAgentIdentity(1, 42);
      expect(await registry.getAgentTokenId(1, user1.address)).to.equal(42);

      // Mint another token and overwrite
      await mockERC721.mint(user1.address, 100);
      await expect(registry.connect(user1).registerAgentIdentity(1, 100))
        .to.emit(registry, "AgentIdentityRegistered")
        .withArgs(1, user1.address, 100);

      expect(await registry.getAgentTokenId(1, user1.address)).to.equal(100);
    });

    it("should not require membership (follows V3 nickname pattern)", async function () {
      // user2 is not a member but can register agent identity
      await mockERC721.mint(user2.address, 77);
      await registry.connect(user2).registerAgentIdentity(1, 77);
      expect(await registry.getAgentTokenId(1, user2.address)).to.equal(77);
    });
  });

  describe("clearAgentIdentity", function () {
    beforeEach(async function () {
      await registry.setIdentityRegistryAddress(await mockERC721.getAddress());
      await mockERC721.mint(user1.address, 42);
      await registry.connect(user1).registerAgentIdentity(1, 42);
    });

    it("should remove registration", async function () {
      expect(await registry.hasAgentIdentity(1, user1.address)).to.be.true;

      await expect(registry.connect(user1).clearAgentIdentity(1))
        .to.emit(registry, "AgentIdentityCleared")
        .withArgs(1, user1.address);

      expect(await registry.getAgentTokenId(1, user1.address)).to.equal(0);
      expect(await registry.hasAgentIdentity(1, user1.address)).to.be.false;
    });

    it("should revert with ApplicationNotFound for bad appId", async function () {
      await expect(
        registry.connect(user1).clearAgentIdentity(999)
      ).to.be.revertedWithCustomError(registry, "ApplicationNotFound");
    });
  });

  describe("getAgentTokenId and hasAgentIdentity", function () {
    it("should return 0 and false for unregistered users", async function () {
      expect(await registry.getAgentTokenId(1, user1.address)).to.equal(0);
      expect(await registry.hasAgentIdentity(1, user1.address)).to.be.false;
    });
  });

  describe("Isolation", function () {
    beforeEach(async function () {
      await registry.setIdentityRegistryAddress(await mockERC721.getAddress());
      await mockERC721.mint(user1.address, 42);
      // Create a second app
      await registry.connect(user2).createApplication("App2", "desc", "url", true);
    });

    it("should isolate registrations between applications", async function () {
      await registry.connect(user1).registerAgentIdentity(1, 42);
      expect(await registry.hasAgentIdentity(1, user1.address)).to.be.true;
      expect(await registry.hasAgentIdentity(2, user1.address)).to.be.false;
    });
  });

  describe("Upgrade Safety", function () {
    it("should preserve existing V3 nickname data after upgrade to V5", async function () {
      // Set a nickname in the existing V5 registry (V3 feature)
      await registry.connect(user1).setNickname(1, "testuser");
      expect(await registry.getNickname(1, user1.address)).to.equal("testuser");

      // Nickname should still work
      expect(await registry.getVersion()).to.equal("5.0.0");
      expect(await registry.getNickname(1, user1.address)).to.equal("testuser");
    });
  });
});
