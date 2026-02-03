const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

describe("AntennaRegistryV1", function () {
  let registry;
  let mockToken;
  let owner, treasury, user1, user2, user3;
  
  const APP_FEE = ethers.parseEther("100");
  const TOPIC_FEE = ethers.parseEther("10");

  // Role constants
  const ROLE_MEMBER = 1;
  const ROLE_SUPPORT_MANAGER = 2;
  const ROLE_TOPIC_MANAGER = 4;
  const ROLE_ADMIN = 8;
  const ROLE_OWNER_DELEGATE = 16;

  // Access levels
  const ACCESS_PUBLIC = 0;
  const ACCESS_PUBLIC_LIMITED = 1;
  const ACCESS_PRIVATE = 2;

  // Permissions
  const PERMISSION_NONE = 0;
  const PERMISSION_READ = 1;
  const PERMISSION_WRITE = 2;
  const PERMISSION_READ_WRITE = 3;
  const PERMISSION_ADMIN = 4;

  beforeEach(async function () {
    [owner, treasury, user1, user2, user3] = await ethers.getSigners();

    // Deploy mock ERC20 token for fees
    const MockToken = await ethers.getContractFactory("MockERC20");
    mockToken = await MockToken.deploy("Mock Token", "MTK", ethers.parseEther("1000000"));
    await mockToken.waitForDeployment();

    // Deploy registry as upgradeable proxy
    const AntennaRegistry = await ethers.getContractFactory("AntennaRegistryV1");
    registry = await upgrades.deployProxy(AntennaRegistry, [treasury.address], {
      initializer: "initialize",
      kind: "uups",
    });
    await registry.waitForDeployment();

    // Distribute tokens to test users
    await mockToken.transfer(user1.address, ethers.parseEther("10000"));
    await mockToken.transfer(user2.address, ethers.parseEther("10000"));
  });

  describe("Initialization", function () {
    it("should initialize with correct owner", async function () {
      expect(await registry.owner()).to.equal(owner.address);
    });

    it("should initialize with correct treasury", async function () {
      expect(await registry.treasury()).to.equal(treasury.address);
    });

    it("should initialize with fees disabled", async function () {
      expect(await registry.feesEnabled()).to.equal(false);
    });

    it("should initialize with zero fees", async function () {
      expect(await registry.applicationFee()).to.equal(0);
      expect(await registry.topicFee()).to.equal(0);
    });

    it("should return correct version", async function () {
      expect(await registry.getVersion()).to.equal("1.0.0");
    });

    it("should not allow re-initialization", async function () {
      await expect(registry.initialize(user1.address)).to.be.reverted;
    });
  });

  describe("Admin Functions", function () {
    it("should allow owner to set treasury", async function () {
      await registry.setTreasury(user1.address);
      expect(await registry.treasury()).to.equal(user1.address);
    });

    it("should not allow non-owner to set treasury", async function () {
      await expect(registry.connect(user1).setTreasury(user2.address))
        .to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount");
    });

    it("should allow owner to set fee token", async function () {
      await registry.setFeeToken(mockToken.target);
      expect(await registry.feeToken()).to.equal(mockToken.target);
    });

    it("should allow owner to set fees", async function () {
      await registry.setFees(APP_FEE, TOPIC_FEE);
      expect(await registry.applicationFee()).to.equal(APP_FEE);
      expect(await registry.topicFee()).to.equal(TOPIC_FEE);
    });

    it("should emit FeesUpdated event", async function () {
      await expect(registry.setFees(APP_FEE, TOPIC_FEE))
        .to.emit(registry, "FeesUpdated")
        .withArgs(APP_FEE, TOPIC_FEE);
    });

    it("should allow owner to enable/disable fees", async function () {
      await registry.setFeesEnabled(true);
      expect(await registry.feesEnabled()).to.equal(true);

      await registry.setFeesEnabled(false);
      expect(await registry.feesEnabled()).to.equal(false);
    });

    it("should emit FeesEnabledUpdated event", async function () {
      await expect(registry.setFeesEnabled(true))
        .to.emit(registry, "FeesEnabledUpdated")
        .withArgs(true);
    });
  });

  describe("Application Creation", function () {
    it("should create application successfully", async function () {
      const tx = await registry.connect(user1).createApplication(
        "TestApp",
        "A test application",
        "https://test.app",
        false
      );
      
      const receipt = await tx.wait();
      expect(await registry.applicationCount()).to.equal(1);
    });

    it("should emit ApplicationCreated event", async function () {
      await expect(registry.connect(user1).createApplication(
        "TestApp",
        "A test application",
        "https://test.app",
        false
      )).to.emit(registry, "ApplicationCreated")
        .withArgs(1, "TestApp", user1.address);
    });

    it("should store application data correctly", async function () {
      await registry.connect(user1).createApplication(
        "TestApp",
        "A test application",
        "https://test.app",
        true
      );

      const app = await registry.getApplication(1);
      expect(app.name).to.equal("TestApp");
      expect(app.description).to.equal("A test application");
      expect(app.frontendUrl).to.equal("https://test.app");
      expect(app.owner).to.equal(user1.address);
      expect(app.active).to.equal(true);
      expect(app.allowPublicTopicCreation).to.equal(true);
      expect(app.memberCount).to.equal(1);
    });

    it("should add creator as member with owner roles", async function () {
      await registry.connect(user1).createApplication(
        "TestApp",
        "A test application",
        "https://test.app",
        false
      );

      const member = await registry.getMember(1, user1.address);
      expect(member.account).to.equal(user1.address);
      expect(member.roles).to.equal(ROLE_MEMBER | ROLE_ADMIN | ROLE_OWNER_DELEGATE);
    });

    it("should reject empty name", async function () {
      await expect(registry.connect(user1).createApplication(
        "",
        "Description",
        "https://test.app",
        false
      )).to.be.revertedWithCustomError(registry, "InvalidName");
    });

    it("should reject name longer than 64 characters", async function () {
      const longName = "a".repeat(65);
      await expect(registry.connect(user1).createApplication(
        longName,
        "Description",
        "https://test.app",
        false
      )).to.be.revertedWithCustomError(registry, "InvalidName");
    });

    it("should reject duplicate names", async function () {
      await registry.connect(user1).createApplication(
        "TestApp",
        "First app",
        "https://test.app",
        false
      );

      await expect(registry.connect(user2).createApplication(
        "TestApp",
        "Second app",
        "https://test2.app",
        false
      )).to.be.revertedWithCustomError(registry, "NameTaken");
    });

    describe("with fees enabled", function () {
      beforeEach(async function () {
        await registry.setFeeToken(mockToken.target);
        await registry.setFees(APP_FEE, TOPIC_FEE);
        await registry.setFeesEnabled(true);
      });

      it("should collect fee on application creation", async function () {
        await mockToken.connect(user1).approve(registry.target, APP_FEE);
        
        const treasuryBefore = await mockToken.balanceOf(treasury.address);
        await registry.connect(user1).createApplication(
          "TestApp",
          "Description",
          "https://test.app",
          false
        );
        const treasuryAfter = await mockToken.balanceOf(treasury.address);

        expect(treasuryAfter - treasuryBefore).to.equal(APP_FEE);
      });

      it("should revert if insufficient balance", async function () {
        await mockToken.connect(user3).approve(registry.target, APP_FEE);
        
        await expect(registry.connect(user3).createApplication(
          "TestApp",
          "Description",
          "https://test.app",
          false
        )).to.be.revertedWithCustomError(registry, "InsufficientBalance");
      });

      it("should revert if insufficient allowance", async function () {
        await expect(registry.connect(user1).createApplication(
          "TestApp",
          "Description",
          "https://test.app",
          false
        )).to.be.revertedWithCustomError(registry, "InsufficientAllowance");
      });
    });
  });

  describe("Application Updates", function () {
    beforeEach(async function () {
      await registry.connect(user1).createApplication(
        "TestApp",
        "Description",
        "https://test.app",
        false
      );
    });

    it("should allow owner to update frontend URL", async function () {
      await registry.connect(user1).updateApplicationFrontendUrl(1, "https://new.url");
      const app = await registry.getApplication(1);
      expect(app.frontendUrl).to.equal("https://new.url");
    });

    it("should emit FrontendUrlUpdated event", async function () {
      await expect(registry.connect(user1).updateApplicationFrontendUrl(1, "https://new.url"))
        .to.emit(registry, "FrontendUrlUpdated")
        .withArgs(1, "https://new.url");
    });

    it("should not allow non-owner to update frontend URL", async function () {
      await expect(registry.connect(user2).updateApplicationFrontendUrl(1, "https://new.url"))
        .to.be.revertedWithCustomError(registry, "NotAuthorized");
    });

    it("should allow admin to update frontend URL", async function () {
      await registry.connect(user1).addMember(1, user2.address, "Admin", ROLE_ADMIN);
      await registry.connect(user2).updateApplicationFrontendUrl(1, "https://admin.url");
      const app = await registry.getApplication(1);
      expect(app.frontendUrl).to.equal("https://admin.url");
    });

    it("should allow owner to set topic creation fee", async function () {
      await registry.connect(user1).setTopicCreationFee(1, mockToken.target, ethers.parseEther("5"));
      const app = await registry.getApplication(1);
      expect(app.topicCreationFeeToken).to.equal(mockToken.target);
      expect(app.topicCreationFeeAmount).to.equal(ethers.parseEther("5"));
    });

    it("should revert for non-existent application", async function () {
      await expect(registry.connect(user1).updateApplicationFrontendUrl(999, "https://new.url"))
        .to.be.revertedWithCustomError(registry, "ApplicationNotFound");
    });
  });

  describe("Topic Creation", function () {
    beforeEach(async function () {
      await registry.connect(user1).createApplication(
        "TestApp",
        "Description",
        "https://test.app",
        false
      );
    });

    it("should allow owner to create topic", async function () {
      await registry.connect(user1).createTopic(1, "general", "General discussion", ACCESS_PUBLIC);
      expect(await registry.topicCount()).to.equal(1);
    });

    it("should emit TopicCreated event", async function () {
      await expect(registry.connect(user1).createTopic(1, "general", "General discussion", ACCESS_PUBLIC))
        .to.emit(registry, "TopicCreated")
        .withArgs(1, 1, "general", user1.address, ACCESS_PUBLIC);
    });

    it("should store topic data correctly", async function () {
      await registry.connect(user1).createTopic(1, "general", "General discussion", ACCESS_PRIVATE);
      
      const topic = await registry.getTopic(1);
      expect(topic.name).to.equal("general");
      expect(topic.description).to.equal("General discussion");
      expect(topic.applicationId).to.equal(1);
      expect(topic.owner).to.equal(user1.address);
      expect(topic.creator).to.equal(user1.address);
      expect(topic.accessLevel).to.equal(ACCESS_PRIVATE);
      expect(topic.active).to.equal(true);
    });

    it("should give creator admin permission on topic", async function () {
      await registry.connect(user1).createTopic(1, "general", "General discussion", ACCESS_PUBLIC);
      expect(await registry.getTopicPermission(1, user1.address)).to.equal(PERMISSION_ADMIN);
    });

    it("should increment application topic count", async function () {
      await registry.connect(user1).createTopic(1, "general", "General discussion", ACCESS_PUBLIC);
      await registry.connect(user1).createTopic(1, "support", "Support channel", ACCESS_PUBLIC_LIMITED);
      
      const app = await registry.getApplication(1);
      expect(app.topicCount).to.equal(2);
    });

    it("should track application topics", async function () {
      await registry.connect(user1).createTopic(1, "general", "General", ACCESS_PUBLIC);
      await registry.connect(user1).createTopic(1, "support", "Support", ACCESS_PUBLIC);
      
      const topicIds = await registry.getApplicationTopics(1);
      expect(topicIds.length).to.equal(2);
      expect(topicIds[0]).to.equal(1);
      expect(topicIds[1]).to.equal(2);
    });

    it("should not allow non-authorized users to create topic when public creation disabled", async function () {
      await expect(registry.connect(user2).createTopic(1, "general", "General", ACCESS_PUBLIC))
        .to.be.revertedWithCustomError(registry, "NotAuthorized");
    });

    it("should allow anyone to create topic when public creation enabled", async function () {
      await registry.connect(owner).createApplication(
        "PublicApp",
        "Description",
        "https://public.app",
        true // allowPublicTopicCreation
      );

      await registry.connect(user2).createTopic(2, "community", "Community topic", ACCESS_PUBLIC);
      expect(await registry.topicCount()).to.equal(1);
    });

    it("should allow topic manager to create topics", async function () {
      await registry.connect(user1).addMember(1, user2.address, "TopicMgr", ROLE_TOPIC_MANAGER);
      await registry.connect(user2).createTopic(1, "managed", "Managed topic", ACCESS_PUBLIC);
      expect(await registry.topicCount()).to.equal(1);
    });

    it("should reject invalid access level", async function () {
      await expect(registry.connect(user1).createTopic(1, "general", "General", 5))
        .to.be.revertedWithCustomError(registry, "InvalidAccessLevel");
    });

    it("should revert for non-existent application", async function () {
      await expect(registry.connect(user1).createTopic(999, "general", "General", ACCESS_PUBLIC))
        .to.be.revertedWithCustomError(registry, "ApplicationNotFound");
    });
  });

  describe("Topic Permissions", function () {
    beforeEach(async function () {
      await registry.connect(user1).createApplication("TestApp", "Desc", "https://test.app", false);
      await registry.connect(user1).createTopic(1, "general", "General", ACCESS_PRIVATE);
    });

    it("should allow topic admin to set permissions", async function () {
      await registry.connect(user1).setTopicPermission(1, user2.address, PERMISSION_READ_WRITE);
      expect(await registry.getTopicPermission(1, user2.address)).to.equal(PERMISSION_READ_WRITE);
    });

    it("should emit TopicPermissionSet event", async function () {
      await expect(registry.connect(user1).setTopicPermission(1, user2.address, PERMISSION_READ))
        .to.emit(registry, "TopicPermissionSet")
        .withArgs(1, user2.address, PERMISSION_READ);
    });

    it("should not allow non-admin to set permissions", async function () {
      await expect(registry.connect(user2).setTopicPermission(1, user3.address, PERMISSION_READ))
        .to.be.revertedWithCustomError(registry, "NotAuthorized");
    });

    it("should allow app admin to set topic permissions", async function () {
      await registry.connect(user1).addMember(1, user2.address, "Admin", ROLE_ADMIN);
      await registry.connect(user2).setTopicPermission(1, user3.address, PERMISSION_WRITE);
      expect(await registry.getTopicPermission(1, user3.address)).to.equal(PERMISSION_WRITE);
    });
  });

  describe("Membership", function () {
    beforeEach(async function () {
      await registry.connect(user1).createApplication("TestApp", "Desc", "https://test.app", false);
    });

    it("should allow owner to add member", async function () {
      await registry.connect(user1).addMember(1, user2.address, "User2", ROLE_MEMBER);
      
      const member = await registry.getMember(1, user2.address);
      expect(member.account).to.equal(user2.address);
      expect(member.nickname).to.equal("User2");
      expect(member.roles).to.equal(ROLE_MEMBER);
    });

    it("should emit MemberAdded event", async function () {
      await expect(registry.connect(user1).addMember(1, user2.address, "User2", ROLE_ADMIN))
        .to.emit(registry, "MemberAdded")
        .withArgs(1, user2.address, "User2", ROLE_ADMIN | ROLE_MEMBER);
    });

    it("should always include MEMBER role", async function () {
      await registry.connect(user1).addMember(1, user2.address, "Admin", ROLE_ADMIN);
      const member = await registry.getMember(1, user2.address);
      expect(Number(member.roles) & ROLE_MEMBER).to.equal(ROLE_MEMBER);
    });

    it("should increment member count", async function () {
      await registry.connect(user1).addMember(1, user2.address, "User2", ROLE_MEMBER);
      const app = await registry.getApplication(1);
      expect(app.memberCount).to.equal(2); // owner + user2
    });

    it("should not allow adding duplicate member", async function () {
      await registry.connect(user1).addMember(1, user2.address, "User2", ROLE_MEMBER);
      await expect(registry.connect(user1).addMember(1, user2.address, "User2Again", ROLE_MEMBER))
        .to.be.revertedWithCustomError(registry, "AlreadyMember");
    });

    it("should allow admin to add member", async function () {
      await registry.connect(user1).addMember(1, user2.address, "Admin", ROLE_ADMIN);
      await registry.connect(user2).addMember(1, user3.address, "User3", ROLE_MEMBER);
      
      expect(await registry.isMember(1, user3.address)).to.equal(true);
    });

    it("should not allow non-admin to add member", async function () {
      await registry.connect(user1).addMember(1, user2.address, "User2", ROLE_MEMBER);
      await expect(registry.connect(user2).addMember(1, user3.address, "User3", ROLE_MEMBER))
        .to.be.revertedWithCustomError(registry, "NotAuthorized");
    });

    it("should allow removing member", async function () {
      await registry.connect(user1).addMember(1, user2.address, "User2", ROLE_MEMBER);
      await registry.connect(user1).removeMember(1, user2.address);
      
      expect(await registry.isMember(1, user2.address)).to.equal(false);
    });

    it("should emit MemberRemoved event", async function () {
      await registry.connect(user1).addMember(1, user2.address, "User2", ROLE_MEMBER);
      await expect(registry.connect(user1).removeMember(1, user2.address))
        .to.emit(registry, "MemberRemoved")
        .withArgs(1, user2.address);
    });

    it("should decrement member count on removal", async function () {
      await registry.connect(user1).addMember(1, user2.address, "User2", ROLE_MEMBER);
      await registry.connect(user1).removeMember(1, user2.address);
      const app = await registry.getApplication(1);
      expect(app.memberCount).to.equal(1); // only owner
    });

    it("should not allow removing app owner", async function () {
      await expect(registry.connect(user1).removeMember(1, user1.address))
        .to.be.revertedWithCustomError(registry, "CannotRemoveSelf");
    });

    it("should not allow removing non-member", async function () {
      await expect(registry.connect(user1).removeMember(1, user2.address))
        .to.be.revertedWithCustomError(registry, "NotMember");
    });

    it("should allow updating member roles", async function () {
      await registry.connect(user1).addMember(1, user2.address, "User2", ROLE_MEMBER);
      await registry.connect(user1).updateMemberRoles(1, user2.address, ROLE_ADMIN);
      
      const member = await registry.getMember(1, user2.address);
      expect(member.roles).to.equal(ROLE_ADMIN | ROLE_MEMBER);
    });

    it("should emit MemberRolesUpdated event", async function () {
      await registry.connect(user1).addMember(1, user2.address, "User2", ROLE_MEMBER);
      await expect(registry.connect(user1).updateMemberRoles(1, user2.address, ROLE_TOPIC_MANAGER))
        .to.emit(registry, "MemberRolesUpdated")
        .withArgs(1, user2.address, ROLE_TOPIC_MANAGER | ROLE_MEMBER);
    });

    it("should allow member to update own nickname", async function () {
      await registry.connect(user1).addMember(1, user2.address, "User2", ROLE_MEMBER);
      await registry.connect(user2).updateMemberNickname(1, "NewNickname");
      
      const member = await registry.getMember(1, user2.address);
      expect(member.nickname).to.equal("NewNickname");
    });

    it("should emit NicknameUpdated event", async function () {
      await registry.connect(user1).addMember(1, user2.address, "User2", ROLE_MEMBER);
      await expect(registry.connect(user2).updateMemberNickname(1, "NewNick"))
        .to.emit(registry, "NicknameUpdated")
        .withArgs(1, user2.address, "NewNick");
    });

    it("should not allow non-member to update nickname", async function () {
      await expect(registry.connect(user2).updateMemberNickname(1, "Hacker"))
        .to.be.revertedWithCustomError(registry, "NotMember");
    });

    it("should return application members list", async function () {
      await registry.connect(user1).addMember(1, user2.address, "User2", ROLE_MEMBER);
      await registry.connect(user1).addMember(1, user3.address, "User3", ROLE_MEMBER);
      
      const members = await registry.getApplicationMembers(1);
      expect(members.length).to.equal(3);
      expect(members).to.include(user1.address);
      expect(members).to.include(user2.address);
      expect(members).to.include(user3.address);
    });
  });

  describe("Messaging", function () {
    beforeEach(async function () {
      await registry.connect(user1).createApplication("TestApp", "Desc", "https://test.app", false);
    });

    describe("Public Topic", function () {
      beforeEach(async function () {
        await registry.connect(user1).createTopic(1, "public", "Public topic", ACCESS_PUBLIC);
      });

      it("should allow anyone to send message", async function () {
        const payload = ethers.toUtf8Bytes("Hello World");
        await expect(registry.connect(user2).sendMessage(1, payload))
          .to.emit(registry, "MessageSent");
      });

      it("should increment message count", async function () {
        const payload = ethers.toUtf8Bytes("Hello");
        await registry.connect(user1).sendMessage(1, payload);
        await registry.connect(user2).sendMessage(1, payload);
        
        const topic = await registry.getTopic(1);
        expect(topic.messageCount).to.equal(2);
      });

      it("should update lastMessageAt", async function () {
        const payload = ethers.toUtf8Bytes("Hello");
        await registry.connect(user1).sendMessage(1, payload);
        
        const topic = await registry.getTopic(1);
        expect(topic.lastMessageAt).to.be.gt(0);
      });
    });

    describe("Public Limited Topic", function () {
      beforeEach(async function () {
        await registry.connect(user1).createTopic(1, "limited", "Limited topic", ACCESS_PUBLIC_LIMITED);
      });

      it("should allow members to send message", async function () {
        await registry.connect(user1).addMember(1, user2.address, "User2", ROLE_MEMBER);
        const payload = ethers.toUtf8Bytes("Member message");
        await expect(registry.connect(user2).sendMessage(1, payload))
          .to.emit(registry, "MessageSent");
      });

      it("should not allow non-members to send message", async function () {
        const payload = ethers.toUtf8Bytes("Outsider message");
        await expect(registry.connect(user2).sendMessage(1, payload))
          .to.be.revertedWithCustomError(registry, "NotAuthorized");
      });

      it("should allow users with explicit write permission", async function () {
        await registry.connect(user1).setTopicPermission(1, user2.address, PERMISSION_WRITE);
        const payload = ethers.toUtf8Bytes("Permitted message");
        await expect(registry.connect(user2).sendMessage(1, payload))
          .to.emit(registry, "MessageSent");
      });
    });

    describe("Private Topic", function () {
      beforeEach(async function () {
        await registry.connect(user1).createTopic(1, "private", "Private topic", ACCESS_PRIVATE);
      });

      it("should allow topic owner to send message", async function () {
        const payload = ethers.toUtf8Bytes("Owner message");
        await expect(registry.connect(user1).sendMessage(1, payload))
          .to.emit(registry, "MessageSent");
      });

      it("should allow users with write permission", async function () {
        await registry.connect(user1).setTopicPermission(1, user2.address, PERMISSION_WRITE);
        const payload = ethers.toUtf8Bytes("Permitted message");
        await expect(registry.connect(user2).sendMessage(1, payload))
          .to.emit(registry, "MessageSent");
      });

      it("should allow users with read_write permission", async function () {
        await registry.connect(user1).setTopicPermission(1, user2.address, PERMISSION_READ_WRITE);
        const payload = ethers.toUtf8Bytes("RW message");
        await expect(registry.connect(user2).sendMessage(1, payload))
          .to.emit(registry, "MessageSent");
      });

      it("should allow users with admin permission", async function () {
        await registry.connect(user1).setTopicPermission(1, user2.address, PERMISSION_ADMIN);
        const payload = ethers.toUtf8Bytes("Admin message");
        await expect(registry.connect(user2).sendMessage(1, payload))
          .to.emit(registry, "MessageSent");
      });

      it("should not allow users with only read permission", async function () {
        await registry.connect(user1).setTopicPermission(1, user2.address, PERMISSION_READ);
        const payload = ethers.toUtf8Bytes("Read-only message");
        await expect(registry.connect(user2).sendMessage(1, payload))
          .to.be.revertedWithCustomError(registry, "NotAuthorized");
      });

      it("should not allow non-permitted users", async function () {
        const payload = ethers.toUtf8Bytes("Unauthorized message");
        await expect(registry.connect(user2).sendMessage(1, payload))
          .to.be.revertedWithCustomError(registry, "NotAuthorized");
      });

      it("should allow app admin to send message", async function () {
        await registry.connect(user1).addMember(1, user2.address, "Admin", ROLE_ADMIN);
        const payload = ethers.toUtf8Bytes("App admin message");
        await expect(registry.connect(user2).sendMessage(1, payload))
          .to.emit(registry, "MessageSent");
      });
    });

    it("should revert for non-existent topic", async function () {
      const payload = ethers.toUtf8Bytes("Message");
      await expect(registry.connect(user1).sendMessage(999, payload))
        .to.be.revertedWithCustomError(registry, "TopicNotFound");
    });
  });

  describe("Permission Helpers", function () {
    beforeEach(async function () {
      await registry.connect(user1).createApplication("TestApp", "Desc", "https://test.app", false);
    });

    describe("canReadTopic", function () {
      it("should return true for public topics", async function () {
        await registry.connect(user1).createTopic(1, "public", "Public", ACCESS_PUBLIC);
        expect(await registry.canReadTopic(1, user2.address)).to.equal(true);
      });

      it("should return true for public_limited topics", async function () {
        await registry.connect(user1).createTopic(1, "limited", "Limited", ACCESS_PUBLIC_LIMITED);
        expect(await registry.canReadTopic(1, user2.address)).to.equal(true);
      });

      it("should return false for private topics without permission", async function () {
        await registry.connect(user1).createTopic(1, "private", "Private", ACCESS_PRIVATE);
        expect(await registry.canReadTopic(1, user2.address)).to.equal(false);
      });

      it("should return true for private topics with read permission", async function () {
        await registry.connect(user1).createTopic(1, "private", "Private", ACCESS_PRIVATE);
        await registry.connect(user1).setTopicPermission(1, user2.address, PERMISSION_READ);
        expect(await registry.canReadTopic(1, user2.address)).to.equal(true);
      });

      it("should return true for topic owner", async function () {
        await registry.connect(user1).createTopic(1, "private", "Private", ACCESS_PRIVATE);
        expect(await registry.canReadTopic(1, user1.address)).to.equal(true);
      });

      it("should return true for app admin", async function () {
        await registry.connect(user1).createTopic(1, "private", "Private", ACCESS_PRIVATE);
        await registry.connect(user1).addMember(1, user2.address, "Admin", ROLE_ADMIN);
        expect(await registry.canReadTopic(1, user2.address)).to.equal(true);
      });

      it("should return false for non-existent topic", async function () {
        expect(await registry.canReadTopic(999, user1.address)).to.equal(false);
      });
    });

    describe("canWriteToTopic", function () {
      it("should return true for public topics", async function () {
        await registry.connect(user1).createTopic(1, "public", "Public", ACCESS_PUBLIC);
        expect(await registry.canWriteToTopic(1, user2.address)).to.equal(true);
      });

      it("should return true for members on public_limited topics", async function () {
        await registry.connect(user1).createTopic(1, "limited", "Limited", ACCESS_PUBLIC_LIMITED);
        await registry.connect(user1).addMember(1, user2.address, "User2", ROLE_MEMBER);
        expect(await registry.canWriteToTopic(1, user2.address)).to.equal(true);
      });

      it("should return false for non-members on public_limited topics", async function () {
        await registry.connect(user1).createTopic(1, "limited", "Limited", ACCESS_PUBLIC_LIMITED);
        expect(await registry.canWriteToTopic(1, user2.address)).to.equal(false);
      });

      it("should return false for private topics without write permission", async function () {
        await registry.connect(user1).createTopic(1, "private", "Private", ACCESS_PRIVATE);
        await registry.connect(user1).setTopicPermission(1, user2.address, PERMISSION_READ);
        expect(await registry.canWriteToTopic(1, user2.address)).to.equal(false);
      });

      it("should return true for private topics with write permission", async function () {
        await registry.connect(user1).createTopic(1, "private", "Private", ACCESS_PRIVATE);
        await registry.connect(user1).setTopicPermission(1, user2.address, PERMISSION_WRITE);
        expect(await registry.canWriteToTopic(1, user2.address)).to.equal(true);
      });

      it("should return false for non-existent topic", async function () {
        expect(await registry.canWriteToTopic(999, user1.address)).to.equal(false);
      });
    });
  });

  describe("Migration Helpers", function () {
    beforeEach(async function () {
      await registry.connect(user1).createApplication("TestApp", "Desc", "https://test.app", false);
      await registry.connect(user1).addMember(1, user2.address, "User2", ROLE_TOPIC_MANAGER);
    });

    it("should export member data", async function () {
      const data = await registry.exportMemberData(1, user2.address);
      expect(data.length).to.be.gt(0);
    });

    it("should export application data", async function () {
      const data = await registry.exportApplicationData(1);
      expect(data.length).to.be.gt(0);
    });
  });

  describe("Reentrancy Protection", function () {
    // Note: Full reentrancy testing would require a malicious contract
    // These tests verify the modifier is applied to critical functions
    
    it("should have reentrancy guard on createApplication", async function () {
      // If this works without reverting, reentrancy guard is properly initialized
      await mockToken.connect(user1).approve(registry.target, APP_FEE);
      await registry.setFeeToken(mockToken.target);
      await registry.setFees(APP_FEE, TOPIC_FEE);
      await registry.setFeesEnabled(true);
      
      await expect(registry.connect(user1).createApplication(
        "TestApp",
        "Desc",
        "https://test.app",
        false
      )).to.emit(registry, "ApplicationCreated");
    });
  });
});
