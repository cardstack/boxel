# Building the Repository

To build the entire repository and run the application, follow these steps:

1. The 2 main system dependencies to install are:

   - [mise](https://mise.jdx.dev/getting-started.html) — manages Node.js and pnpm versions automatically from `.mise.toml`
   - [docker](https://docs.docker.com/get-docker/)

2. Clone the repo:

   ```zsh
   git clone https://github.com/cardstack/boxel.git
   ```

3. Install the package dependencies:

   ```zsh
   mise install
   pnpm install
   ```

4. Build the boxel-ui and boxel-motion addons:

   ```zsh
   cd ./packages/boxel-ui/addon
   pnpm rebuild:icons
   pnpm build
   cd ../../boxel-motion/addon
   pnpm build
   ```

5. Build the boxel-icons:

   ```zsh
   cd ./packages/boxel-icons
   pnpm build
   ```

6. Build the host:

   ```zsh
   cd ./packages/host
   pnpm start
   ```

7. Run the realm server:

   ```zsh
   cd ./packages/realm-server
   DISABLE_MODULE_CACHING=true pnpm start:all
   ```

   Note: Ensure that the realm-server is completely started by looking out for tor the test-realm indexing output.

   ```zsh
   Realm http://localhost:4202/test/ has started ({
   "instancesIndexed": 8,
   "instanceErrors": 0,
   "moduleErrors": 0
   })
   ```

8. Register ALL:

   ```zsh
   cd ./packages/matrix
   pnpm register-all
   ```

9. Verify registration:

   ```zsh
   cd ./packages/matrix
   pnpm start:admin
   ```

   Visit http://localhost:8080. Type in Username = "admin", Password: "password" Homeserver URL: http://localhost:8008

10. Host App

    - Visit http://localhost:4201/
    - Enter the registration flow and create a Boxel Account
    - When prompted for an authentication token, type in "dev-token"

11. Validate email for login

    - Visit SMTP UI at http://localhost:5001/
    - Validate email
    - Go back to Host http://localhost:4201/ and login

12. Perform "Setup up Secure Payment Method" flow

    - More detailed steps can be found in our [README](README.md) Payment Setup section

13. Run ai bot (Optional):

    ```zsh
    cd ./packages/ai-bot
    OPENROUTER_API_KEY=*** pnpm start
    ```

## Cleanup command

If you experience issues, you can start from scratch by running this command

```
pnpm clear-caches
pnpm full-reset
```
