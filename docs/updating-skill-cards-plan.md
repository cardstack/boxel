# Skill Card Update Plan

## Overview
When a newer version of a skill card is uploaded to a room, we need to ensure it replaces the older version. This document outlines the implementation plan and test cases.

## Implementation Steps

### 1. Track Command Definitions
- Create `commandDefinitionHashes` map in Matrix service similar to `cardHashes`
- Track command definitions by their coderef as the unique identifier
- Store hash of command definition content for quick comparison

### 2. Update `addSkillCardsToRoomHistory` Method
- When adding a skill card, if a new event ID results, add the new version to room history and update room state, enabling the skill if it is currently disabled

### 3. Update `addCommandDefinitionsToRoomHistory`
- When adding a command card, check if a card with the same ID exists in the room
- Compare content hash of existing skill card with new one
- If identical, skip sending (no-op)
- If different, add the new version to room history

### 4. Update AI Bot Logic ✓ (WORKING)
- Modify the history construction to always use the latest version of a skill card
- Group skill cards by ID and select the most recent version based on timestamp
- Ensure the bot uses the latest command definitions when generating responses
- Filter out older versions of the same skill card when building context

## Test Cases

### Host Tests

1. **No Changes to Skill Card**
   - Add same skill card to room twice with no changes
   - Verify no new event is sent to room history
   - Verify room state remains unchanged

2. **Updated Skill Card Instructions**
   - Add skill card to room
   - Update the skill card's instructions
   - Add the updated skill card to the same room
   - Verify new event is sent to room history
   - Verify room state is updated to point to new event ID
   - Verify enabled/disabled state is preserved

3. **Updated Command Definition**
   - Add skill card with command to room
   - Update the command definition
   - Add the skill card to the same room again
   - Verify new event is sent with updated command
   - Verify room state is updated

### AI Bot Tests

1. **Updated Skill Card Instructions in Prompt** ✓ (DONE)
   - Already covered in `packages/ai-bot/tests/prompt-construction-test.ts` via test:
   - `'Has the skill card specified by the last state update, even if there are other skill cards with the same id'`
   - Test verifies that only the most recent skill card instructions are included in the prompt
   - Explicitly checks that old instructions (SKILL_INSTRUCTIONS_V1) are excluded while new instructions (SKILL_INSTRUCTIONS_V2) are included

2. **Updated Command Definition in Response** ✓ (DONE)
   - Added new test in `packages/ai-bot/tests/prompt-construction-test.ts`:
   - `'Uses updated command definitions when skill card is updated'`
   - Test verifies that only the updated command definitions are included in available tools
   - Explicitly checks that old command description (COMMAND_DESCRIPTION_V1) is excluded while new description (COMMAND_DESCRIPTION_V2) is included
