# Going live on a free server — step by step

This puts Ensoftic POS on the internet at no cost, good for a pilot with real shops.

| Piece | Free service |
| --- | --- |
| Server (runs everything, database included) | **Oracle Cloud Always Free**: an ARM machine with up to 4 CPUs, 24 GB RAM and 200 GB disk, free indefinitely |
| Web address | **DuckDNS**, e.g. `colombo-pos.duckdns.org` |
| HTTPS certificate | Automatic (Let's Encrypt, through Caddy) |
| E-mail (sign-up confirmation, password reset, invitations) | **Brevo**, 300 e-mails a day free |
| Product photos (optional) | Oracle Object Storage, 10 GB free |

Budget about **1–2 hours** the first time. Commands in `grey boxes` are typed exactly as shown;
replace the parts in `<angle brackets>`.

> Oracle asks for a credit or debit card to confirm who you are. "Always Free" resources are
> not charged; stay on the shapes named below and you will not pay anything.

---

## Step 1 — Create the free accounts

1. **Oracle Cloud:** <https://www.oracle.com/cloud/free/> › *Start for free*.
   - Choose a **home region** close to Sri Lanka: **India West (Mumbai)**, **India South
     (Hyderabad)** or **Singapore**. It cannot be changed later.
2. **DuckDNS:** <https://www.duckdns.org>, signing in with Google or GitHub.
   - Create a sub-domain, e.g. `colombo-pos`, which gives you `colombo-pos.duckdns.org`.
   - Leave the IP empty for now. Keep the page open: you need the **token** shown at the top
     later.
3. **Brevo:** <https://www.brevo.com> (free plan).
   - **Senders, Domains & Dedicated IPs › Senders:** add and verify the e-mail address mails
     will come from, e.g. your Gmail.
   - **SMTP & API › SMTP:** note the **Login** and create an **SMTP key**.

## Step 2 — Create the server on Oracle Cloud

1. Menu › **Compute › Instances › Create instance**.
2. **Name:** `ensoftic-pos`.
3. **Image and shape › Edit:**
   - **Image:** *Canonical Ubuntu 24.04*;
   - **Shape:** *Ampere › VM.Standard.A1.Flex*, with **2 OCPUs** and **12 GB** memory (inside
     Always Free).
4. **Networking:** keep *Create new virtual cloud network*, and make sure *Assign a public
   IPv4 address* is on.
5. **Add SSH keys:** choose **Generate a key pair for me** and press **Save private key**.
   Keep the file safe, e.g. `C:\Users\<you>\.ssh\ensoftic-pos.key`. It is the only way in.
6. Press **Create**. When the instance is *Running*, copy its **Public IP address**.

> **"Out of capacity"?** Free ARM machines are popular. Try another *Availability domain* in
> the same form, try a little later, or start with 1 OCPU / 6 GB.

**Open the web ports in Oracle's firewall:**
1. On the instance page, open the **Subnet** link, then its **Default Security List**.
2. **Add Ingress Rules** twice, both with source `0.0.0.0/0`:
   - **TCP, destination port 80**;
   - **TCP, destination port 443**.

**Point your address at the server:** on DuckDNS, enter the **Public IP** next to your
sub-domain and press **update ip**.

## Step 3 — Connect to the server

From **PowerShell** on your computer:

```powershell
ssh -i C:\Users\<you>\.ssh\ensoftic-pos.key ubuntu@<public-ip>
```

Answer `yes` the first time. If Windows complains the key is "too open", run this once and
then try again:

```powershell
icacls C:\Users\<you>\.ssh\ensoftic-pos.key /inheritance:r /grant:r "$($env:USERNAME):R"
```

Everything from here on is typed **on the server**, in that SSH window.

## Step 4 — Get the code and prepare the server

```sh
git clone https://github.com/Ensoftics/POS.git
cd POS
sudo sh infra/deploy/setup-server.sh
exit
```

> **Private repository?**
> 1. On GitHub: *Settings › Developer settings › Personal access tokens › Fine-grained*.
> 2. Create a token with **read-only Contents** access to `Ensoftics/POS`.
> 3. Clone with `git clone https://<token>@github.com/Ensoftics/POS.git`.

`setup-server.sh` installs Docker, opens ports 80 and 443 in the server's own firewall
(Oracle's Ubuntu blocks them by default), and switches on automatic security updates.

Connect again with the same `ssh` command from Step 3, so Docker works without `sudo`.

## Step 5 — Create the settings

```sh
cd ~/POS/infra/deploy
sh make-env.sh <your-subdomain>.duckdns.org <your-email>
nano .env
```

`make-env.sh` creates strong random passwords for the database and the sign-in secret. In
`nano`, set the two e-mail lines with your Brevo details, then save with **Ctrl+O**, Enter,
**Ctrl+X**:

```sh
SMTP_URL=smtp://<brevo-login>:<brevo-smtp-key>@smtp-relay.brevo.com:587
MAIL_FROM="Ensoftic POS <<the sender you verified in Brevo>>"
```

> `.env` holds the passwords. Copy it into your password manager:
> `cat ~/POS/infra/deploy/.env` shows it.

## Step 6 — Build and start

```sh
cd ~/POS
sh infra/deploy/deploy.sh
```

The first build takes about **10–20 minutes**. It then starts, in order:
1. the database;
2. the database setup (migrations);
3. the API;
4. the web app;
5. Caddy, which fetches the HTTPS certificate.

The end of the output lists the services and the address.

## Step 7 — Check it live

1. Open `https://<your-subdomain>.duckdns.org` on your computer **and on your phone**. The
   padlock should show a valid certificate.
2. **Create account** with your real e-mail, then confirm it from the e-mail Brevo delivers.
3. Choose the business type, add a product, receive stock, open a shift and make a sale,
   following [docs/user-guide.md](../user-guide.md).
4. Give yourself the **platform console** (super admin):

   ```sh
   cd ~/POS/infra/deploy
   docker compose run --rm api node dist/scripts/platform-admin.js grant <your-email>
   ```

   Add the printed key to Google or Microsoft Authenticator (*Enter a setup key*), then sign
   in at `https://<your-subdomain>.duckdns.org/platform/login`.

**If something is not right:**

```sh
cd ~/POS/infra/deploy
docker compose ps              # every service should be "running" / "healthy"
docker compose logs --tail 50 caddy   # certificate problems
docker compose logs --tail 50 api     # application errors
```

## Step 8 — Product photos (optional)

1. Oracle menu › **Storage › Buckets › Create bucket** named `ensoftic-pos-images`, keeping
   it **Private**.
2. Profile icon › **My profile › Customer secret keys › Generate secret key**. Copy the
   **secret** (shown once) and the **Access key**.
3. Profile icon › **Tenancy** › copy the **Object storage namespace**.
4. In `~/POS/infra/deploy/.env`, uncomment the `S3_...` and `IMAGE_ORIGIN` lines and fill
   them in. For the Mumbai region:

   ```sh
   S3_ENDPOINT=https://<namespace>.compat.objectstorage.ap-mumbai-1.oraclecloud.com
   S3_REGION=ap-mumbai-1
   S3_BUCKET=ensoftic-pos-images
   S3_ACCESS_KEY_ID=<access key>
   S3_SECRET_ACCESS_KEY=<secret>
   S3_FORCE_PATH_STYLE=true
   IMAGE_ORIGIN=https://<namespace>.compat.objectstorage.ap-mumbai-1.oraclecloud.com
   ```

5. Apply with `cd ~/POS && sh infra/deploy/deploy.sh`.

## Step 9 — Nightly backups

Backups go to an Oracle bucket of their own, encrypted before they leave the server.

1. Create a second private bucket, `ensoftic-pos-backups`.
2. Fill in the backup settings:

   ```sh
   cd ~/POS/infra/backup
   cp .env.example .env
   nano .env
   ```

   - `MIGRATION_DATABASE_URL`: copy the line from `~/POS/infra/deploy/.env` as it is (host
     `postgres`).
   - `BACKUP_S3_ENDPOINT`, `BACKUP_S3_REGION`, `BACKUP_S3_ACCESS_KEY_ID`,
     `BACKUP_S3_SECRET_ACCESS_KEY`: the same Oracle values as Step 8.
   - `BACKUP_BUCKET=ensoftic-pos-backups`.
   - `BACKUP_PASSPHRASE`: a long passphrase. **Also store it in your password manager.
     Without it the backups cannot be read.**
   - The `S3_...` lines: the photo bucket from Step 8. Leave them empty if you skipped photos.
   - Add these two lines:

     ```sh
     COMPOSE_PATH_SEPARATOR=:
     COMPOSE_FILE=docker-compose.yml:docker-compose.single-server.yml
     ```

3. Test once with `sh nightly.sh`. It should end with `nightly backup finished`.
4. Run it every night at 01:15 UTC (06:45 in Sri Lanka): run `crontab -e`, then add

   ```
   15 1 * * * cd /home/ubuntu/POS/infra/backup && sh nightly.sh >> /home/ubuntu/pos-backup.log 2>&1
   ```

5. Once a month, follow the restore drill in [backup-and-restore.md](backup-and-restore.md).

## Updating to a new version

When new code has been pushed to GitHub:

```sh
cd ~/POS
git pull
sh infra/deploy/deploy.sh
```

The database changes are applied automatically before the new version starts.

## Good to know

- **Limits:** the free server comfortably handles a pilot of several shops (see
  [the load test](../performance/load-test-2026-10.md)).
- **One server, one point of failure:** for many paying shops, move the database to a managed
  service ([deployment.md](deployment.md)).
- **Online payments (PayHere) and SMS (Notify.lk):** switch on when you have merchant
  accounts, by adding their lines in `.env` and running `deploy.sh`.
- **A real domain later**, e.g. `pos.yourcompany.lk`:
  1. point its DNS **A record** at the server;
  2. change `APP_DOMAIN`, `CORS_ORIGINS`, `WEB_APP_URL` and `API_PUBLIC_URL` in `.env`;
  3. run `deploy.sh`.

  Caddy fetches the new certificate itself.
- **Security:** keep the SSH key and `.env` private. Only ports 22, 80 and 443 are open; the
  database is never reachable from the internet.
