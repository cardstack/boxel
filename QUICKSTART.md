# Building the Repository

To build the entire repository and run the application, follow these steps:

1. The 2 main system dependencies to install are:

   - [volta](https://docs.volta.sh/guide/getting-started)
   - [docker](https://docs.docker.com/get-docker/)

2. Clone the repo:

   ```zsh
   git clone https://github.com/cardstack/boxel.git
   ```

3. Install the package dependencies:

   ```zsh
   echo 'export VOLTA_FEATURE_PNPM=1"' >> ~/.zprofile && source ~/.zprofile
   pnpm install
   ```

4. Build the boxel-ui:

   ```zsh
   cd ./packages/boxel-ui/addon
   pnpm rebuild:icons
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
   pnpm start:all
   ```

7. Register ALL

   ```zsh
   cd ./packages/matrix
   pnpm register-all
   ```

8. Verify registration

```zsh
cd ./packages/matrix
pnpm start:admin
```

Visit http://localhost:8080. Type in Username = "admin", Password: "password" Homeserver URL: http://localhost:8008

11. Host App

- Visit http://localhost:4201/
- Create new user
- When prompted for an authentication token, type in "dev-token"

12. Validate email for login:

- Visit SMTP UI at http://localhost:5001/
- Validate email
- Go back to Host and login

13. Run ai bot (Optional):

    ```zsh
    OPENAI_KEY=*** pnpm start
    ```

## Cleanup command

If you experience issues, you can start from scratch by running this command

```
pnpm clear-caches
rm -rf ./packages/matrix/synapse-data
docker ps -a --format '{{.Names}}' | grep -E 'boxel-smtp|boxel-synapse|synapse-admin' | xargs -r docker stop
docker ps -a --format '{{.Names}}' | grep -E 'boxel-smtp|boxel-synapse|synapse-admin' | xargs -r docker rm -v
```
