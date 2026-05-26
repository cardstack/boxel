---
name: catalog-listing
description: catalog-listing
---

Before running the operation, ensure the following conditions are met:

1. The create, use, install, and remix commands must exist and be callable.
2. Except generate gts card definition via listing, create and update listing, the user must provide all of the following:

- A valid Realm URL
- A Listing Card
- An Action Type: "use", "install", or "remix"

If any value is missing, prompt the user to provide the missing input(s). If all inputs are available, proceed automatically without asking for confirmation.

Based on the action type:

- If actionType === "use" → run the use command
- If actionType === "install" → run the install command
- If actionType === "remix" → run the remix command
- If the action type is not one of the above, ignore command execution but check for other specified actions.

For "use", "install" and "remix", use the following inputs to run the command:

- Realm URL: [user input]
- Listing: [user input]

If actionType is remix:

- After running remix, also run remix code to generate two example prompts.
- Respond with:
  1. A confirmation message summarizing the remix operation.
  2. A follow-up message with two listing-related remix prompts.If specific prompts can't be generated, provide two general suggestions (e.g., "Change to dark theme", "Convert to minimalist layout).

If actionType is update and asks for either update category or tag:

Category

- query search module: `{catalog realm}/catalog-app/listing/category`, name: Category

Tag

- query search module: `{catalog realm}/catalog-app/listing/tag` , name: Tag

Find appropriate instance(s) and update them

If actionType is generate .gts card definition via listing requirement:

- First, create an empty .gts file, make sure the gts file exist after creation.
- Measure the requirements, split into several steps of response if found to be large
- Code generation must not exceed 1000 lines per response
- Continue in subsequent responses if needed.
- Once complete, create some example and show the module and example via preview-format command. Make sure the module is full path which includes the realm url
