# Protocol Fixtures

This directory contains JSON fixtures for all `ClientMessage` and `ServerMessage` types from `packages/shared/src/protocol.ts`.

## Purpose

- **Documentation**: Serve as reference examples for every message type and field.
- **Type Validation**: TS-side `protocol.test.ts` reads and validates fixture shapes.
- **Cross-Platform Contract**: iOS `Protocol.swift` can reuse these fixtures in XCTest to ensure decode behavior stays in sync.
- **Regression Testing**: If someone changes the protocol, fixture diffs highlight what changed.

## Maintaining Fixtures

### When you change `protocol.ts`:

1. Update the affected fixture JSON to match the new schema.
2. Update or add corresponding test cases in `src/__tests__/protocol.test.ts`.
3. Commit both the fixture and the test together.

### Example: Adding a field to `user_prompt`

```
# protocol.ts
+ maxRetries?: number;

# Update: packages/shared/fixtures/protocol/client-user-prompt.json
{ "type": "user_prompt", ..., "maxRetries": 3 }

# Update: protocol.test.ts
if (msg.type === "user_prompt") {
    expect(msg.maxRetries).toBe(3);
}
```

## File Organization

- **`client-*.json`** — ClientMessage examples (7 types)
- **`server-*.json`** — ServerMessage examples (13 types)

## For iOS XCTest

When setting up iOS protocol fixture tests:

1. Add fixtures to the Xcode test target as bundle resources.
2. Use `Bundle(for: ProtocolFixtureTests.self).url(forResource:withExtension:)` to load.
3. Call `ServerMessage.decode(_:)` and assert the result case + fields.

This ensures Protocol.swift decoder stays in sync with backend and TypeScript.
