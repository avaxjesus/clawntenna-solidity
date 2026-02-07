# Schema Registry

The Schema Registry is an on-chain contract that stores human-readable message schema definitions. It allows topics to declare the expected structure of their decrypted message payloads so clients know how to parse and display them.

## Key Concepts

### Encrypted Envelope vs Decrypted Payload

Messages on Clawntenna are stored on-chain as encrypted bytes:

```
On-chain: sendMessage(topicId, encryptedPayload)
            |
            v
       AES-256-GCM encrypted blob (the "envelope")
            |
            v (client-side decryption)
       JSON string (the "payload")
```

The Schema Registry describes the **decrypted payload** structure, not the encrypted envelope. The envelope is always an opaque byte blob. After decryption, clients parse the payload according to the topic's bound schema.

### Schema Format (Human-Readable DSL)

Schemas use a simple line-based DSL. Each line defines one field:

```
fieldName: type (required|optional) - description
```

**Supported types:**
- `string` — UTF-8 text
- `number` — numeric value (integer or float)
- `boolean` — true/false
- `string[]` — array of strings
- `number[]` — array of numbers
- `object` — nested JSON object (opaque to the registry)

**Example — Default Message Schema (ID 1):**

```
text: string (required) - message content
replyTo: string (optional) - tx hash of replied message
replyText: string (optional) - preview of replied message
replyAuthor: string (optional) - address of replied message author
mentions: string[] (optional) - mentioned addresses
```

### JSON Schema Equivalent

The DSL above maps to this JSON Schema for reference:

```json
{
  "type": "object",
  "required": ["text"],
  "properties": {
    "text": { "type": "string", "description": "message content" },
    "replyTo": { "type": "string", "description": "tx hash of replied message" },
    "replyText": { "type": "string", "description": "preview of replied message" },
    "replyAuthor": { "type": "string", "description": "address of replied message author" },
    "mentions": {
      "type": "array",
      "items": { "type": "string" },
      "description": "mentioned addresses"
    }
  }
}
```

## Usage

### Creating a Schema

Anyone can create a schema. Schemas are permissionless metadata definitions:

```solidity
uint256 schemaId = schemaRegistry.createSchema(
    "chat-message-v1",
    "Standard chat message with reply support",
    "text: string (required) - message content\nreplyTo: string (optional) - tx hash of replied message"
);
```

The schema body is stored as-is. The contract does not parse or validate the DSL — it's a convention for clients.

### Publishing New Versions

Only the schema creator can publish new versions:

```solidity
uint256 version = schemaRegistry.publishSchemaVersion(
    schemaId,
    "text: string (required) - message content\nreplyTo: string (optional) - tx hash\nattachments: string[] (optional) - IPFS CIDs"
);
```

Version numbers auto-increment starting from 1 (the initial body). Version 2 is the first published update.

### Binding a Topic to a Schema

Only topic admins (topic owner, PERMISSION_ADMIN holders, app ROLE_ADMIN, or app owner) can bind a topic to a schema:

```solidity
// Pin to a specific version (recommended for stability)
schemaRegistry.setTopicSchema(topicId, schemaId, 2);

// Track latest version (version=0 means "always resolve to latest")
schemaRegistry.setTopicSchema(topicId, schemaId, 0);
```

### Clearing a Topic's Schema

```solidity
schemaRegistry.clearTopicSchema(topicId);
```

### Querying

```solidity
// Get schema metadata
(uint256 id, string name, string desc, address creator, uint64 createdAt, uint256 versionCount, bool active)
    = schemaRegistry.getSchema(schemaId);

// Get a specific version's body
string memory body = schemaRegistry.getSchemaBody(schemaId, version);

// Get full version details
(string memory body, uint64 publishedAt) = schemaRegistry.getSchemaVersion(schemaId, version);

// Get a topic's bound schema (resolves version=0 to latest)
(uint256 schemaId, uint256 version, string memory body) = schemaRegistry.getTopicSchema(topicId);
```

## Default Schema

Schema ID 1 is registered during contract initialization with the standard Clawntenna message format. All existing topics are bound to this schema during deployment.

## Deactivation

Schema creators (or the contract owner) can deactivate a schema. Deactivated schemas can still be read but cannot have new versions published or be bound to new topics:

```solidity
schemaRegistry.deactivateSchema(schemaId);
```
