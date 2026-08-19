# Common Errors & Fixes

```
❌ "Error: XML parameter tags in JSON"
  └─ 💡 NEVER mix XML syntax with JSON:
     ✗ "attributes": "<parameter name=\"x\">value"
     ✓ "attributes": {"x": "value"}

❌ "Error: arguments instead of payload"
  └─ 💡 Use correct key name:
     ✗ "arguments": {...}
     ✓ "payload": {...}

❌ "Error: attributes is a string instead of object"
  └─ 💡 attributes MUST be a JSON object, NEVER a string:
     ✗ "attributes": "{\"cardId\": \"https://...\"}"
     ✓ "attributes": {"cardId": "https://..."}

❌ "Error: relationships inside attributes string"
  └─ 💡 relationships is a SIBLING of attributes, not inside it:
     ✗ "attributes": "{...}, \"relationships\": {...}"
     ✓ "attributes": {...}, "relationships": {...}

❌ "Error: fieldUpdates contains escaped newlines or XML fragments"
  └─ 💡 fieldUpdates values must be clean strings or objects:
     ✗ "description": "line1\\n- bullet\\n- bullet2\"}}>"
     ✓ "description": "line1\n- bullet\n- bullet2"
     ✗ Mixing XML tags like `">` or `}}>`
     ✓ Pure JSON with proper newline escapes (single backslash \n)

❌ "Error: attributes is not valid JSON"
  └─ 💡 Check for escaped quotes inside attributes object
     ✓ "value": "text"
     ✗ "value": \"{\"nested\": \"data\"}\"

❌ "Error: missing required field X"
  └─ 💡 Check the command's "Full tool call syntax" example

❌ "Error: cardId is invalid"
  └─ 💡 Verify URL is complete and matches pattern:
     https://[domain]/[user]/[workspace]/[type]/[id]

❌ "Error: field path not found"
  └─ 💡 Use correct notation:
     ✓ "chapters[0].title"
     ✗ "chapters.0.title" (inconsistent)
     ✗ "chapters.title[0]" (wrong order)

❌ "Error: attributes is required but missing"
   └─ 💡 Even if no params needed, include empty object:
      ✓ "attributes": {}
      ✗ missing attributes entirely
```
