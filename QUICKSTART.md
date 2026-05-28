# Building the Repository

To build the entire repository and run the application, follow these steps:

1. The system dependencies to install are:
   - [mise](https://mise.jdx.dev/getting-started.html)
   - [docker](https://docs.docker.com/get-docker/)
   - [mkcert](https://github.com/FiloSottile/mkcert) — provisions the
     local TLS cert the realm-server needs to speak HTTPS+HTTP/2 (local
     dev has no HTTP fallback). Install with
     `sudo apt install -y mkcert libnss3-tools` on Debian/Ubuntu or
     `brew install mkcert nss` on macOS. After install, run
     `mise run infra:ensure-dev-cert` once before the first
     `mise run dev` / `pnpm start:all`; subsequent runs are a no-op. See
     the repo-root [README](README.md#local-https-dev-access) for details.

2. Clone the repo:

   ```zsh
   git clone https://github.com/cardstack/boxel.git
   ```

3. Install the package dependencies:

   ```zsh
   mise install
   pnpm install
   ```

4. Build the boxel-icons:

   ```zsh
   cd ./packages/boxel-icons
   pnpm build
   ```

5. Build the host:

   ```zsh
   cd ./packages/host
   pnpm start
   ```

6. Run the realm server:

   ```zsh
   cd ./packages/realm-server
   DISABLE_MODULE_CACHING=true pnpm start:all
   ```

   Note: Ensure that the realm-server is completely started by looking out for tor the test-realm indexing output.

   ```zsh
   Realm https://localhost:4202/test/ has started ({
   "instancesIndexed": 8,
   "instanceErrors": 0,
   "moduleErrors": 0
   })
   ```

7. Register ALL:

   ```zsh
   cd ./packages/matrix
   pnpm register-all
   ```

8. Verify registration:

   ```zsh
   cd ./packages/matrix
   pnpm start:admin
   ```

   Visit http://localhost:8080. Type in Username = "admin", Password: "password" Homeserver URL: http://localhost:8008

9. Host App
   - Visit https://localhost:4200/
   - Enter the registration flow and create a Boxel Account
   - When prompted for an authentication token, type in "dev-token"

10. Validate email for login
    - Visit SMTP UI at http://localhost:5001/
    - Validate email
    - Go back to Host https://localhost:4200/ and login

11. Perform "Setup up Secure Payment Method" flow
    - More detailed steps can be found in our [README](README.md) Payment Setup section

12. Run ai bot (Optional):

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
