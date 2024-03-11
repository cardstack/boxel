Feature: Two users can chat with each other

  Scenario: Bob and Alice chat
    Given a flow
    And Bob is a member of the flow
    And Alice is a member of the flow
    And I am logged in as Bob
    And Bob is viewing the flow
    When I send "Hi Alice, how are you today?"
    And Alice sends "Hi Bob, I am fine"
    Then I should see a message from Alice "Hi Bob, I am fine"
