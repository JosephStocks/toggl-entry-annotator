# Sync Toggl Track Events

This is a full-stack application for syncing [Toggl Track](https://toggl.com/track/) time entries to a local database. It provides a private web interface to view, filter, and annotate your time entries with personal notes and daily summaries.

The main motivation is to have a private, enhanced view of your Toggl data, allowing for more detailed annotations and daily summaries than Toggl's native features provide.

## Features

- **Backend**:
    - Built with [FastAPI](https://fastapi.tiangolo.com/).
    - Syncs Toggl time entries into a local [SQLite](https://www.sqlite.org/index.html) database.
    - Provides a REST API for the frontend to consume.
    - Automated nightly backups of the database to a cloud provider (e.g., Google Drive) using `rclone` and `supercronic`.
    - Containerized with Docker for consistent deployments.

- **Frontend**:
    - Built with [React](https://reactjs.org/), [Vite](https://vitejs.dev/), and [TypeScript](https://www.typescriptlang.org/).
    - UI components from the [Mantine](https://mantine.dev/) library.
    - Uses [TanStack React Query](https://tanstack.com/query/latest) for data fetching, caching, and optimistic UI updates.
    - Daily view of time entries with easy navigation.
    - A markdown-enabled editor for daily "end-of-day" notes, complete with a preview mode and export functionality.
    - Ability to add and delete notes on individual time entries.
    - Filter entries by project.
    - Displays the currently running Toggl timer with a live-updating duration.

## Architecture

The project is a classic client-server application. The backend runs on a server, periodically syncing data from the Toggl API into an SQLite database. The frontend is a single-page application that interacts with the backend's API to display and manipulate the data.

```mermaid
graph TD
    subgraph Browser
        Frontend[React App]
    end

    subgraph "Server (Fly.io)"
        Backend[FastAPI Server]
        Cron[Supercronic Cron] --> BackupScript[backup.sh]
    end

    subgraph "Local Storage (Fly.io Volume)"
        Database[(SQLite DB)]
    end

    subgraph "External Services"
        Toggl[Toggl Track API]
        CloudBackup[Cloud Storage]
    end

    Frontend <-- HTTP API --> Backend
    Backend  <-- Sync --> Toggl
    Backend  <-- CRUD --> Database
    BackupScript --> Database
    BackupScript --> CloudBackup
```

## Setup and Running

### Prerequisites

-   [Python 3.12+](https://www.python.org/)
-   [`uv`](https://astral.sh/uv/) (Python package/dependency manager)
-   [Node.js and pnpm](https://pnpm.io/installation)

### 1. Backend Setup

The backend server is responsible for syncing data from Toggl and providing it to the frontend.

1.  **Navigate to the backend directory:**
    ```bash
    cd backend
    ```

2.  **Set up environment variables:**
    Create a `.env` file by copying the example:
    ```bash
    cp .env.example .env
    ```
    Now, edit `.env` and fill in your details:
    -   `TOGGL_TOKEN`: Your Toggl API token, found on your [profile page](https://track.toggl.com/profile).
    -   `WORKSPACE_ID`: Find this in the URL of your Toggl workspace (e.g., `https://track.toggl.com/reports/summary/<WORKSPACE_ID>`).
    -   `DB_PATH`: For local development, set this to the relative path where you want the database stored. The recommended default is: `DB_PATH="data/time_tracking.sqlite"`

3.  **Install Python dependencies:**
    ```bash
    uv sync
    ```

4.  **Initialize the Database:**
    The database and its tables are now created **automatically** the first time you run the server. No manual steps are needed.

5.  **Run the Backend Server:**
    ```bash
    uv run uvicorn main:app --host 0.0.0.0 --port 4545 --reload
    ```
    The API will be available at `http://localhost:4545`. The server will create the `data/time_tracking.sqlite` file on its first run.

6.  **(Optional) Perform Initial Data Sync:**
    Once the server is running, open the web UI and use the "Run Full Sync" button in the "Sync Toggl Data" panel to populate your database with your entire Toggl history.

### 2. Frontend Setup

The frontend provides the web interface for interacting with your synced data.

1.  **Navigate to the frontend directory:**
    ```bash
    cd frontend
    ```

2.  **Install Node.js dependencies:**
    ```bash
    pnpm install
    ```

3.  **Run the Frontend Development Server:**
    ```bash
    pnpm dev
    ```
    The app will be available at `http://localhost:5173`.

    **Note:** The Vite dev server is configured to proxy API requests (`/api`) to the backend at `http://localhost:4545`. If you change the backend port, update `frontend/vite.config.ts` accordingly.

## Testing

This project uses `pytest` for the backend and `vitest` for the frontend.

### Backend

From the `backend` directory:

1.  **Run all tests:**
    ```bash
    uv run pytest
    ```

2.  **Run tests with code coverage:**
    This command runs the tests and generates a coverage report in the `htmlcov/` directory.
    ```bash
    uv run pytest --cov
    ```

### Frontend

From the `frontend` directory:

1.  **Run all tests:**
    ```bash
    pnpm test
    ```

## API Endpoints

The backend exposes the following main endpoints:

-   `POST /sync/full`: Kicks off a full sync of all time entries from Toggl.
-   `POST /sync/recent`: Syncs the last 2 days of time entries.
-   `GET /sync/current`: Gets the currently running time entry from Toggl.
-   `GET /time_entries`: Fetches time entries for a given UTC datetime window.
-   `GET /projects`: Returns a list of all unique project names.
-   `POST /notes`: Adds a note to a time entry.
-   `DELETE /notes/{note_id}`: Deletes a note.
-   `GET /daily_notes/{date}`: Gets the daily note for a specific date (YYYY-MM-DD).
-   `PUT /daily_notes/{date}`: Creates or updates the daily note for a specific date.

Check the backend code in `backend/main.py` for more details on the API.

## Deployment & Authentication

This guide details how to deploy the full-stack application to production using Fly.io for the backend, Netlify for the frontend, and Cloudflare for DNS and authentication.

The final architecture uses Cloudflare Zero Trust to protect both the frontend and backend.

### 1. Prerequisites

- A registered domain name managed by Cloudflare.
- Accounts for Fly.io, Netlify, and Cloudflare.
- `flyctl` CLI installed.
- `rclone` configured with a remote for database backups (e.g., `gdrive:`).

### 2. Backend Deployment on Fly.io

1.  **Login to Fly:**
    ```bash
    flyctl auth login
    ```

2.  **Create a Persistent Volume:**
    The SQLite database needs to be stored on a persistent volume to survive deployments. Create a volume for your app (e.g., 1GB).
    ```bash
    # Note: Replace 'your-app-name-api' with the name in your fly.toml
    flyctl volumes create data --size 1 --app your-app-name-api
    ```
    Your `fly.toml` is already configured to use this volume at the `/data` mount point.

3.  **Set Secrets:**
    The backend needs your Toggl credentials and your `rclone.conf` for backups.
    ```bash
    # Replace with your actual app name and credentials
    flyctl secrets set TOGGL_TOKEN="YOUR_TOGGL_TOKEN" WORKSPACE_ID="YOUR_WORKSPACE_ID" --app your-app-name-api

    # Encode your rclone.conf file and set it as a secret
    flyctl secrets set RCLONE_CONF="$(cat ~/.config/rclone/rclone.conf | base64)" --app your-app-name-api
    ```

4.  **Deploy the Backend:**
    Since the repository already contains a configured `fly.toml`, you do not need to run `launch`. Simply deploy the existing configuration:
    ```bash
    flyctl deploy --config backend/fly.toml
    ```
    After deployment, Fly.io will give you a hostname like `your-app-name-api.fly.dev`.

### 3. DNS Configuration on Cloudflare

1.  **Create a CNAME record for your backend API.** This must be set to **DNS Only** (grey cloud) to work with Fly.io's SSL certificate provisioning.
    - **Type:** `CNAME`
    - **Name:** `api.your-domain.com`
    - **Target:** `your-app-name-api.fly.dev`
    - **Proxy status:** DNS Only

2.  **Create a CNAME record for the Fly.io SSL certificate.** Fly.io requires this for domain validation.
    - **Type:** `CNAME`
    - **Name:** `_acme-challenge.api`
    - **Target:** `your-app-name-api.fly.dev`
    - **Proxy status:** DNS Only

3.  **Point your main frontend domain to Netlify.** The specifics will be provided by Netlify, but it's typically a CNAME record. This one should be **Proxied** (orange cloud) to benefit from Cloudflare's features.
    - **Type:** `CNAME`
    - **Name:** `your-app-name.your-domain.com`
    - **Target:** `your-app.netlify.app`
    - **Proxy status:** Proxied

### 4. Frontend Deployment on Netlify

1.  **Connect Your Git Repository:**
    In the Netlify dashboard, add a new site and connect it to the Git repository containing this project.

2.  **Configure Build Settings:**
    Netlify needs to know how to build the site from the `frontend` subdirectory.
    - **Base directory:** `frontend`
    - **Build command:** `pnpm run build`
    - **Publish directory:** `dist`
    The `frontend/netlify.toml` file in this repository is already configured with these settings.

3.  **(Optional) Add Service-Token Environment Variables**
    If you decide to re-enable the backend's *service-token* middleware (see below), Netlify must be able to inject those headers. Add the following build-time variables under **Site settings → Build & deploy → Environment**:
    - `VITE_CF_ACCESS_CLIENT_ID` – the Service-Token *Client ID*
    - `VITE_CF_ACCESS_CLIENT_SECRET` – the Service-Token *Client Secret*
    (Variables need the `VITE_` prefix so Vite exposes them to the browser bundle.)

4.  **Deploy:**
    Trigger a deployment on Netlify. It will build and deploy your frontend.

### 5. Authentication with Cloudflare Zero Trust

This is the final step to secure your application.

1.  **Create a Service Token:**
    - In the Cloudflare Zero Trust dashboard, go to **Access > Service Auth**.
    - Click **Create Service Token**.
    - Name it (e.g., `Netlify Proxy`), and click **Generate token**.
    - **Important:** Copy the `Client ID` and `Client Secret`. Add them to your Netlify environment variables as described in the previous section if you choose to use them.

2.  **Create the Frontend Application:**
    - Go to **Access > Applications** and **Add an application** of type **Self-hosted**.
    - **Application name:** `Your App Name Frontend`
    - **Application domain:** `your-app-name.your-domain.com`
    - **Policies:** Create an `Allow` policy that requires authentication from your chosen provider (e.g., a rule for `Emails` matching your Google account).

3.  **Create the Backend Application:**
    - Add another **Self-hosted** application.
    - **Application name:** `Your App Name Backend`
    - **Application domain:** `api.your-domain.com`
    - **Policies:** Create a policy to allow access. For simple two-person use, an `Allow` rule matching your and your spouse's email is sufficient. If you need automated jobs, you can create more complex policies involving service tokens.

### 6. (Optional) Re-enabling Service-token Checks

`CloudflareServiceTokenMiddleware` is included in the backend but ships with an empty `protected_paths` set, meaning **no route is currently guarded**. This fits the current use-case (two trusted users behind Cloudflare Access). To lock down administrative routes again you can:

```python
# main.py
app.add_middleware(
    CloudflareServiceTokenMiddleware,
    protected_paths={"/sync/full", "/sync/recent"},
)
```

Set `CF_CHECK=true` (default) on Fly and provide the `CF_ACCESS_CLIENT_*` secrets. The frontend must then send the two headers, which you can enable by defining `VITE_CF_ACCESS_CLIENT_*` at build time as shown above.

---

Once these steps are complete, your application will be deployed and protected by Cloudflare Access.

## Future Improvements

-   **User Authentication**: Secure the application with a more granular, in-app login system.
-   **More Advanced Reporting**: Add charts and summaries for time spent on projects.
-   **Configuration UI**: Allow setting Toggl credentials from the UI instead of a `.env` file.
-   **Schema Migrations**: Use a tool like Alembic for managing database schema changes.