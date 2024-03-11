# Invites
- Bob invites Alice to join a flow
- Bob invites Alice to fulfill a card request

# Card Requests
- Chat with a request for a card
- Chat with a request for a card of a particular type
  - provide a catalog entry

# Card Updates
- Bob posts a card to the flow that is partially filled out and explains that he needs help adding shipping information. Alice adds that info and posts the card back to the room. Participants can see the card history. 

# Bots
- Human <> Bot interaction (chatbot)
  - Bot escalating to customer service rep by inviting her
- Collaborator is not there yet
  - Bot is present and lets the user know
  - Collaborator joins and takes over
- Bot requests additional information from submitter (in form of a card)
- Human delegates to bot to complete collection of payment information

# Chained Flows
- After completing payment, schedule delivery in a new flow (subflow with shared order info and delivery team)
## ...with return value:
- store credit card application as subflow, issued credit card card is returned to the original flow
### To explore:
- Explore sharing at beginning/end of subflow ; i.e. handoff to fraud department
- How are messages interleaved when they are sent to the parent flow _during_ the subflow

# Data Collection via Bot Assistant
  - User responds to chat messages with messages and media uploads and bot assembles card(s) to fulfill expectation
  - Bot notifies recipient after attaching new card

# Agents
- Bob asks shopping bot to notify him when a Samsung TV is on sale
  - Bot notifies Bob and offers him "Buy" flow
- Bob initiates payment process that has a delay, and payment bot monitors that payment for completion and posts to the flow when it finishes 

# Boxel Builder
- Bob askes builder to update a definition to have his compamy logo similar to an invite that he provides. Builder posts iterations of definition with sample instance into the flow for Bob to preview and provide feedback.

# Awareness / Announcements
- Bob and his colleagues are all members of a BigCo Announcements channel, where key company news is shared by management
  - Explore redaction -- management may not want to share everything
  - Explore using AI to create a shareable card that conforms to company policy 
- Bob and his sales team and all members of a Sales Activity chanel, where each sale is automatically posted by a bot and team members congratulate each other and watch their performance to quota numbers.

# Web3
- Bob would like to sell 10 BTC at a market price. Bot quotes a price with a 10-minute rate lock and an offer to buy. (Quote card automatically offers to get a new quote after expiration). Bob expresses intent to sell at quote price. Bob sends funds on chain. Waiting for mining. Bot triggers sending of funds to Bob's address.
  - during long operations, bot posts a "live" card that Bob can monitor for progress and assures Bob that it will post to the flow when the operation completes.
## To explore:
- Interacting with a smart contract where a message is a prepared for Bob to sign.

# Managing RFP
- Bob initiates a flow an RFP bot, which solicits the RFP card and the "target" vendors. Bot then initiates flows (chained to this one) with bot, Bob, and each vendor to solicit proposals.
## To explore
- how are RFP subflows represented as they progress? What does completion of a subflow mean? Do subflows get "closed"?

# Show Button in place of fast flows

# DAO use cases
# AI Review of Smart Contract transactiones (before signing)
