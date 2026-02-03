const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

describe("TopicKeyManagerV1", function () {
  let keyManager;
  let registry;
  let owner, user1, user2, user3;
  
  // Valid compressed secp256k1 public keys (33 bytes, starts with 02 or 03)
  // These are example keys - in production they'd be derived from private keys
  const VALID_PUBKEY_1 = "0x02" + "a".repeat(64); // 33 bytes total
  const VALID_PUBKEY_2 = "0x03" + "b".repeat(64);
  const VALID_PUBKEY_3 = "0x02" + "c".repeat(64);
  
  // Invalid public keys for testing
  const INVALID_PUBKEY_TOO_SHORT = "0x02" + "a".repeat(62); // 32 bytes
  const INVALID_PUBKEY_TOO_LONG = "0x02" + "a".repeat(66); // 34 bytes
  const INVALID_PUBKEY_WRONG_PREFIX = "0x04" + "a".repeat(64); // Wrong prefix
  
  // Valid encrypted key (must be at least 44 bytes: 12 IV + ciphertext + 16 tag)
  const VALID_ENCRYPTED_KEY = "0x" + "aa".repeat(48); // 48 bytes
  const INVALID_ENCRYPTED_KEY_TOO_SHORT = "0x" + "aa".repeat(20); // 20 bytes

  beforeEach(async function () {
    [owner, user1, user2, user3] = await ethers.getSigners();

    // Deploy a minimal mock registry (just need an address)
    const MockRegistry = await ethers.getContractFactory("MockRegistry");
    registry = await MockRegistry.deploy();
    await registry.waitForDeployment();

    // Deploy key manager as upgradeable proxy
    const TopicKeyManager = await ethers.getContractFactory("TopicKeyManagerV1");
    keyManager = await upgrades.deployProxy(TopicKeyManager, [registry.target], {
      initializer: "initialize",
      kind: "uups",
    });
    await keyManager.waitForDeployment();
  });

  describe("Initialization", function () {
    it("should initialize with correct owner", async function () {
      expect(await keyManager.owner()).to.equal(owner.address);
    });

    it("should initialize with correct registry", async function () {
      expect(await keyManager.registry()).to.equal(registry.target);
    });

    it("should return correct version", async function () {
      expect(await keyManager.getVersion()).to.equal("1.0.0");
    });

    it("should not allow re-initialization", async function () {
      await expect(keyManager.initialize(user1.address)).to.be.reverted;
    });
  });

  describe("Admin Functions", function () {
    it("should allow owner to set registry", async function () {
      await keyManager.setRegistry(user1.address);
      expect(await keyManager.registry()).to.equal(user1.address);
    });

    it("should not allow non-owner to set registry", async function () {
      await expect(keyManager.connect(user1).setRegistry(user2.address))
        .to.be.revertedWithCustomError(keyManager, "OwnableUnauthorizedAccount");
    });
  });

  describe("Public Key Registration", function () {
    it("should register valid public key", async function () {
      await keyManager.connect(user1).registerPublicKey(VALID_PUBKEY_1);
      expect(await keyManager.hasPublicKey(user1.address)).to.equal(true);
    });

    it("should store public key correctly", async function () {
      await keyManager.connect(user1).registerPublicKey(VALID_PUBKEY_1);
      expect(await keyManager.getPublicKey(user1.address)).to.equal(VALID_PUBKEY_1);
    });

    it("should emit PublicKeyRegistered event on first registration", async function () {
      await expect(keyManager.connect(user1).registerPublicKey(VALID_PUBKEY_1))
        .to.emit(keyManager, "PublicKeyRegistered")
        .withArgs(user1.address, VALID_PUBKEY_1);
    });

    it("should emit PublicKeyUpdated event on update", async function () {
      await keyManager.connect(user1).registerPublicKey(VALID_PUBKEY_1);
      await expect(keyManager.connect(user1).registerPublicKey(VALID_PUBKEY_2))
        .to.emit(keyManager, "PublicKeyUpdated")
        .withArgs(user1.address, VALID_PUBKEY_2);
    });

    it("should allow updating public key", async function () {
      await keyManager.connect(user1).registerPublicKey(VALID_PUBKEY_1);
      await keyManager.connect(user1).registerPublicKey(VALID_PUBKEY_2);
      expect(await keyManager.getPublicKey(user1.address)).to.equal(VALID_PUBKEY_2);
    });

    it("should accept key starting with 0x02", async function () {
      const key02 = "0x02" + "d".repeat(64);
      await expect(keyManager.connect(user1).registerPublicKey(key02))
        .to.emit(keyManager, "PublicKeyRegistered");
    });

    it("should accept key starting with 0x03", async function () {
      const key03 = "0x03" + "e".repeat(64);
      await expect(keyManager.connect(user1).registerPublicKey(key03))
        .to.emit(keyManager, "PublicKeyRegistered");
    });

    it("should reject key that is too short", async function () {
      await expect(keyManager.connect(user1).registerPublicKey(INVALID_PUBKEY_TOO_SHORT))
        .to.be.revertedWithCustomError(keyManager, "InvalidPublicKey");
    });

    it("should reject key that is too long", async function () {
      await expect(keyManager.connect(user1).registerPublicKey(INVALID_PUBKEY_TOO_LONG))
        .to.be.revertedWithCustomError(keyManager, "InvalidPublicKey");
    });

    it("should reject key with wrong prefix", async function () {
      await expect(keyManager.connect(user1).registerPublicKey(INVALID_PUBKEY_WRONG_PREFIX))
        .to.be.revertedWithCustomError(keyManager, "InvalidPublicKey");
    });

    it("should return false for unregistered user", async function () {
      expect(await keyManager.hasPublicKey(user1.address)).to.equal(false);
    });

    it("should return empty bytes for unregistered user public key", async function () {
      expect(await keyManager.getPublicKey(user1.address)).to.equal("0x");
    });
  });

  describe("Key Grant - Single", function () {
    beforeEach(async function () {
      // Register public keys for granter and recipient
      await keyManager.connect(user1).registerPublicKey(VALID_PUBKEY_1);
      await keyManager.connect(user2).registerPublicKey(VALID_PUBKEY_2);
    });

    it("should grant key access successfully", async function () {
      await keyManager.connect(user1).grantKeyAccess(1, user2.address, VALID_ENCRYPTED_KEY);
      expect(await keyManager.hasKeyAccess(1, user2.address)).to.equal(true);
    });

    it("should emit KeyAccessGranted event", async function () {
      await expect(keyManager.connect(user1).grantKeyAccess(1, user2.address, VALID_ENCRYPTED_KEY))
        .to.emit(keyManager, "KeyAccessGranted")
        .withArgs(1, user2.address, user1.address, 0); // version 0
    });

    it("should store grant data correctly", async function () {
      await keyManager.connect(user1).grantKeyAccess(1, user2.address, VALID_ENCRYPTED_KEY);
      
      const grant = await keyManager.getKeyGrant(1, user2.address);
      expect(grant.encryptedKey).to.equal(VALID_ENCRYPTED_KEY);
      expect(grant.granterPublicKey).to.equal(VALID_PUBKEY_1);
      expect(grant.granter).to.equal(user1.address);
      expect(grant.keyVersion).to.equal(0);
      expect(grant.grantedAt).to.be.gt(0);
    });

    it("should reject if recipient has no public key", async function () {
      await expect(keyManager.connect(user1).grantKeyAccess(1, user3.address, VALID_ENCRYPTED_KEY))
        .to.be.revertedWithCustomError(keyManager, "PublicKeyNotRegistered")
        .withArgs(user3.address);
    });

    it("should reject if granter has no public key", async function () {
      await keyManager.connect(user3).registerPublicKey(VALID_PUBKEY_3);
      // user3 has pubkey but is granting to user3 from owner who doesn't have pubkey
      await expect(keyManager.connect(owner).grantKeyAccess(1, user3.address, VALID_ENCRYPTED_KEY))
        .to.be.revertedWithCustomError(keyManager, "PublicKeyNotRegistered")
        .withArgs(owner.address);
    });

    it("should reject encrypted key that is too short", async function () {
      await expect(keyManager.connect(user1).grantKeyAccess(1, user2.address, INVALID_ENCRYPTED_KEY_TOO_SHORT))
        .to.be.revertedWithCustomError(keyManager, "InvalidEncryptedKey");
    });

    it("should allow overwriting existing grant", async function () {
      const newEncryptedKey = "0x" + "bb".repeat(48);
      await keyManager.connect(user1).grantKeyAccess(1, user2.address, VALID_ENCRYPTED_KEY);
      await keyManager.connect(user1).grantKeyAccess(1, user2.address, newEncryptedKey);
      
      const grant = await keyManager.getKeyGrant(1, user2.address);
      expect(grant.encryptedKey).to.equal(newEncryptedKey);
    });

    it("should use current key version", async function () {
      await keyManager.connect(user1).rotateKey(1); // version 1
      await keyManager.connect(user1).rotateKey(1); // version 2
      await keyManager.connect(user1).grantKeyAccess(1, user2.address, VALID_ENCRYPTED_KEY);
      
      const grant = await keyManager.getKeyGrant(1, user2.address);
      expect(grant.keyVersion).to.equal(2);
    });
  });

  describe("Key Grant - Batch", function () {
    beforeEach(async function () {
      await keyManager.connect(user1).registerPublicKey(VALID_PUBKEY_1);
      await keyManager.connect(user2).registerPublicKey(VALID_PUBKEY_2);
      await keyManager.connect(user3).registerPublicKey(VALID_PUBKEY_3);
    });

    it("should batch grant key access", async function () {
      const encKey1 = "0x" + "aa".repeat(48);
      const encKey2 = "0x" + "bb".repeat(48);
      
      await keyManager.connect(user1).batchGrantKeyAccess(
        1,
        [user2.address, user3.address],
        [encKey1, encKey2]
      );
      
      expect(await keyManager.hasKeyAccess(1, user2.address)).to.equal(true);
      expect(await keyManager.hasKeyAccess(1, user3.address)).to.equal(true);
    });

    it("should emit KeyAccessGranted for each user", async function () {
      const encKey1 = "0x" + "aa".repeat(48);
      const encKey2 = "0x" + "bb".repeat(48);
      
      const tx = keyManager.connect(user1).batchGrantKeyAccess(
        1,
        [user2.address, user3.address],
        [encKey1, encKey2]
      );
      
      await expect(tx)
        .to.emit(keyManager, "KeyAccessGranted")
        .withArgs(1, user2.address, user1.address, 0);
      await expect(tx)
        .to.emit(keyManager, "KeyAccessGranted")
        .withArgs(1, user3.address, user1.address, 0);
    });

    it("should reject mismatched array lengths", async function () {
      const encKey1 = "0x" + "aa".repeat(48);
      
      await expect(keyManager.connect(user1).batchGrantKeyAccess(
        1,
        [user2.address, user3.address],
        [encKey1] // only one key
      )).to.be.revertedWithCustomError(keyManager, "ArrayLengthMismatch");
    });

    it("should reject batch larger than 50", async function () {
      const addresses = [];
      const keys = [];
      for (let i = 0; i < 51; i++) {
        addresses.push(user2.address);
        keys.push("0x" + "aa".repeat(48));
      }
      
      await expect(keyManager.connect(user1).batchGrantKeyAccess(1, addresses, keys))
        .to.be.revertedWithCustomError(keyManager, "BatchSizeTooLarge");
    });

    it("should reject if any recipient lacks public key", async function () {
      const encKey1 = "0x" + "aa".repeat(48);
      const encKey2 = "0x" + "bb".repeat(48);
      
      await expect(keyManager.connect(user1).batchGrantKeyAccess(
        1,
        [user2.address, owner.address], // owner has no pubkey
        [encKey1, encKey2]
      )).to.be.revertedWithCustomError(keyManager, "PublicKeyNotRegistered");
    });

    it("should reject if any encrypted key is invalid", async function () {
      const encKey1 = "0x" + "aa".repeat(48);
      const invalidKey = "0x" + "aa".repeat(10); // too short
      
      await expect(keyManager.connect(user1).batchGrantKeyAccess(
        1,
        [user2.address, user3.address],
        [encKey1, invalidKey]
      )).to.be.revertedWithCustomError(keyManager, "InvalidEncryptedKey");
    });
  });

  describe("Key Revocation", function () {
    beforeEach(async function () {
      await keyManager.connect(user1).registerPublicKey(VALID_PUBKEY_1);
      await keyManager.connect(user2).registerPublicKey(VALID_PUBKEY_2);
      await keyManager.connect(user1).grantKeyAccess(1, user2.address, VALID_ENCRYPTED_KEY);
    });

    it("should allow granter to revoke access", async function () {
      await keyManager.connect(user1).revokeKeyAccess(1, user2.address);
      expect(await keyManager.hasKeyAccess(1, user2.address)).to.equal(false);
    });

    it("should emit KeyAccessRevoked event", async function () {
      await expect(keyManager.connect(user1).revokeKeyAccess(1, user2.address))
        .to.emit(keyManager, "KeyAccessRevoked")
        .withArgs(1, user2.address);
    });

    it("should allow owner to revoke access", async function () {
      await keyManager.connect(owner).revokeKeyAccess(1, user2.address);
      expect(await keyManager.hasKeyAccess(1, user2.address)).to.equal(false);
    });

    it("should not allow non-granter/non-owner to revoke", async function () {
      await expect(keyManager.connect(user3).revokeKeyAccess(1, user2.address))
        .to.be.revertedWithCustomError(keyManager, "NotAuthorized");
    });

    it("should clear grant data on revocation", async function () {
      await keyManager.connect(user1).revokeKeyAccess(1, user2.address);
      const grant = await keyManager.getKeyGrant(1, user2.address);
      expect(grant.encryptedKey).to.equal("0x");
      expect(grant.granter).to.equal(ethers.ZeroAddress);
    });
  });

  describe("Key Rotation", function () {
    it("should increment key version", async function () {
      expect(await keyManager.keyVersions(1)).to.equal(0);
      
      await keyManager.connect(user1).rotateKey(1);
      expect(await keyManager.keyVersions(1)).to.equal(1);
      
      await keyManager.connect(user1).rotateKey(1);
      expect(await keyManager.keyVersions(1)).to.equal(2);
    });

    it("should emit KeyRotated event", async function () {
      await expect(keyManager.connect(user1).rotateKey(1))
        .to.emit(keyManager, "KeyRotated")
        .withArgs(1, 1);
    });

    it("should allow anyone to rotate (for now)", async function () {
      // Current implementation doesn't restrict rotation
      // This documents current behavior - may want to add restrictions later
      await expect(keyManager.connect(user2).rotateKey(1))
        .to.emit(keyManager, "KeyRotated");
    });

    it("should track versions per topic", async function () {
      await keyManager.connect(user1).rotateKey(1);
      await keyManager.connect(user1).rotateKey(1);
      await keyManager.connect(user1).rotateKey(2);
      
      expect(await keyManager.keyVersions(1)).to.equal(2);
      expect(await keyManager.keyVersions(2)).to.equal(1);
    });
  });

  describe("Key Retrieval", function () {
    beforeEach(async function () {
      await keyManager.connect(user1).registerPublicKey(VALID_PUBKEY_1);
      await keyManager.connect(user2).registerPublicKey(VALID_PUBKEY_2);
      await keyManager.connect(user1).grantKeyAccess(1, user2.address, VALID_ENCRYPTED_KEY);
    });

    it("should return key data via getMyKey", async function () {
      const [encryptedKey, granterPublicKey, granter, keyVersion, currentVersion] = 
        await keyManager.connect(user2).getMyKey(1);
      
      expect(encryptedKey).to.equal(VALID_ENCRYPTED_KEY);
      expect(granterPublicKey).to.equal(VALID_PUBKEY_1);
      expect(granter).to.equal(user1.address);
      expect(keyVersion).to.equal(0);
      expect(currentVersion).to.equal(0);
    });

    it("should indicate when key was rotated", async function () {
      await keyManager.connect(user1).rotateKey(1);
      
      const [,,,keyVersion, currentVersion] = await keyManager.connect(user2).getMyKey(1);
      
      expect(keyVersion).to.equal(0); // Grant was at version 0
      expect(currentVersion).to.equal(1); // Current is version 1
    });

    it("should return empty data for non-granted user", async function () {
      const [encryptedKey, granterPublicKey, granter, keyVersion, currentVersion] = 
        await keyManager.connect(user3).getMyKey(1);
      
      expect(encryptedKey).to.equal("0x");
      expect(granterPublicKey).to.equal("0x");
      expect(granter).to.equal(ethers.ZeroAddress);
      expect(keyVersion).to.equal(0);
    });

    it("should return grant details via getKeyGrant", async function () {
      const grant = await keyManager.getKeyGrant(1, user2.address);
      
      expect(grant.encryptedKey).to.equal(VALID_ENCRYPTED_KEY);
      expect(grant.granterPublicKey).to.equal(VALID_PUBKEY_1);
      expect(grant.granter).to.equal(user1.address);
    });
  });

  describe("hasKeyAccess", function () {
    beforeEach(async function () {
      await keyManager.connect(user1).registerPublicKey(VALID_PUBKEY_1);
      await keyManager.connect(user2).registerPublicKey(VALID_PUBKEY_2);
    });

    it("should return true when user has access", async function () {
      await keyManager.connect(user1).grantKeyAccess(1, user2.address, VALID_ENCRYPTED_KEY);
      expect(await keyManager.hasKeyAccess(1, user2.address)).to.equal(true);
    });

    it("should return false when user has no access", async function () {
      expect(await keyManager.hasKeyAccess(1, user2.address)).to.equal(false);
    });

    it("should return false after revocation", async function () {
      await keyManager.connect(user1).grantKeyAccess(1, user2.address, VALID_ENCRYPTED_KEY);
      await keyManager.connect(user1).revokeKeyAccess(1, user2.address);
      expect(await keyManager.hasKeyAccess(1, user2.address)).to.equal(false);
    });

    it("should return false for wrong topic", async function () {
      await keyManager.connect(user1).grantKeyAccess(1, user2.address, VALID_ENCRYPTED_KEY);
      expect(await keyManager.hasKeyAccess(2, user2.address)).to.equal(false);
    });
  });

  describe("Migration Helpers", function () {
    beforeEach(async function () {
      await keyManager.connect(user1).registerPublicKey(VALID_PUBKEY_1);
      await keyManager.connect(user2).registerPublicKey(VALID_PUBKEY_2);
      await keyManager.connect(user1).grantKeyAccess(1, user2.address, VALID_ENCRYPTED_KEY);
      await keyManager.connect(user1).grantKeyAccess(2, user2.address, VALID_ENCRYPTED_KEY);
    });

    it("should export user data", async function () {
      const data = await keyManager.exportUserData(user2.address, [1, 2]);
      expect(data.length).to.be.gt(0);
      // Data is abi-encoded, we just verify it returns something
    });

    it("should export data for multiple topics", async function () {
      const data = await keyManager.exportUserData(user2.address, [1, 2, 3]); // 3 has no grant
      expect(data.length).to.be.gt(0);
    });
  });

  describe("Edge Cases", function () {
    it("should handle topic ID 0", async function () {
      await keyManager.connect(user1).registerPublicKey(VALID_PUBKEY_1);
      await keyManager.connect(user2).registerPublicKey(VALID_PUBKEY_2);
      
      // Topic 0 should work the same as any other topic
      await keyManager.connect(user1).grantKeyAccess(0, user2.address, VALID_ENCRYPTED_KEY);
      expect(await keyManager.hasKeyAccess(0, user2.address)).to.equal(true);
    });

    it("should handle very large topic IDs", async function () {
      await keyManager.connect(user1).registerPublicKey(VALID_PUBKEY_1);
      await keyManager.connect(user2).registerPublicKey(VALID_PUBKEY_2);
      
      const largeTopicId = ethers.MaxUint256;
      await keyManager.connect(user1).grantKeyAccess(largeTopicId, user2.address, VALID_ENCRYPTED_KEY);
      expect(await keyManager.hasKeyAccess(largeTopicId, user2.address)).to.equal(true);
    });

    it("should handle empty batch grant", async function () {
      await keyManager.connect(user1).registerPublicKey(VALID_PUBKEY_1);
      
      // Empty arrays should succeed (no-op)
      await keyManager.connect(user1).batchGrantKeyAccess(1, [], []);
      // No error means success
    });

    it("should handle self-grant", async function () {
      await keyManager.connect(user1).registerPublicKey(VALID_PUBKEY_1);
      
      // User can grant to themselves
      await keyManager.connect(user1).grantKeyAccess(1, user1.address, VALID_ENCRYPTED_KEY);
      expect(await keyManager.hasKeyAccess(1, user1.address)).to.equal(true);
    });
  });
});
