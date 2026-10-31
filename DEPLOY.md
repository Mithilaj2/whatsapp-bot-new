# Going live: step-by-step

This puts We Brand 360 on your own server, with HTTPS, daily backups and WhatsApp connected.
Plan about an hour. You type a few commands; the setup script does the rest.

**You need:** a cloud server (VPS), access to the DNS of webrand360.com, your Meta app details
(App ID, App secret, system user token), and access to the GitHub repository.

## 1. Buy the server

- Ubuntu **24.04 LTS**, **2 vCPU / 4 GB RAM / 80 GB disk** to start (4 vCPU / 8 GB when volume
  grows). DigitalOcean, Hostinger VPS or AWS Lightsail all work. Pick a **Bangalore or Mumbai**
  region.
- Choose **SSH key** login if offered (safer than a password).
- Note the server's **public IP address**.

## 2. Point the domain to it

In the DNS settings of webrand360.com add:

| Type | Name | Value |
|---|---|---|
| A | `app` | your server's IP |

The panel will be at **https://app.webrand360.com**. The main webrand360.com stays free for your
website. DNS can take from a few minutes to a few hours; check with `ping app.webrand360.com`.

## 3. Log in to the server

On Windows open PowerShell, on Mac open Terminal:

```
ssh root@YOUR_SERVER_IP
```

Then switch on the firewall (only SSH, HTTP and HTTPS open):

```
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable
apt update && apt -y upgrade && apt -y install git unattended-upgrades
```

## 4. Get the code

The repository is private, so give the server read-only access with a deploy key:

```
ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519
cat ~/.ssh/id_ed25519.pub
```

Copy the line it prints. On GitHub: repository **Settings → Deploy keys → Add deploy key**, paste,
leave "Allow write access" **off**, save. Then:

```
git clone git@github.com:Mithilaj2/whatsapp-bot-new.git /opt/webrand360
cd /opt/webrand360
```

## 5. Run the setup

```
sudo bash deploy/setup.sh
```

It asks for the panel address (`app.webrand360.com`), an email for certificate notices, and the
password for the first admin login (12+ characters). It writes `.env.production` with fresh
secrets and then stops, asking for the WhatsApp details:

```
nano .env.production
```

Fill in `META_APP_ID`, `META_APP_SECRET` and `META_ACCESS_TOKEN` (see README, "Connecting
WhatsApp"). Optional: `ANTHROPIC_API_KEY` for AI answers in Bot Studio. Save (Ctrl+O, Enter,
Ctrl+X) and run the setup again:

```
sudo bash deploy/setup.sh
```

The first build takes 5 to 10 minutes. At the end it prints the webhook URL and verify token for
Meta. **Keep `.env.production` private** - it holds every key. Never paste it in a chat or email.

## 6. First login

Open **https://app.webrand360.com**, log in as `admin` with the password you chose, and check:
the padlock shows in the browser, the dashboard loads, Masters → Countries lists countries.

## 7. Connect WhatsApp

1. developers.facebook.com → your app → **WhatsApp → Configuration → Webhook → Edit**:
   - Callback URL: `https://app.webrand360.com/api/webhooks/meta`
   - Verify token: the one setup printed (also `META_VERIFY_TOKEN` in `.env.production`)
   - Subscribe to `messages`, `message_template_status_update`, `phone_number_quality_update`
2. In the panel: **Masters → WhatsApp numbers → Add number** with the Phone number ID and WhatsApp
   Business Account ID (App → WhatsApp → API Setup). Tick *Default* for the shared Premium number.
3. **Masters → Templates → New template**, wait for approval, then **Send test** to your own phone.

## 8. Go-live checklist

- [ ] Demo Premium campaign to 3-5 of your own numbers: delivered and read show in the report
- [ ] Reply from your phone: it appears in Incoming messages; reply back from the panel
- [ ] Reply STOP: the number shows in Opt-outs
- [ ] A bot on a Branded number answers "hi"
- [ ] Credits move correctly: give, take back, campaign charge, refund for a failed number
- [ ] A notification arrives (bell) when the campaign finishes
- [ ] Next morning: a backup exists in `/var/backups/webrand360`
- [ ] Admin password changed from the one used in setup (top right → Change password)

## Reseller domains (white label)

A reseller who wants `panel.theiragency.com`:

1. In the panel, edit the reseller and set **Domain** to `panel.theiragency.com`.
2. The reseller adds a DNS record: `CNAME panel → app.webrand360.com` (or an A record to the IP).
3. They open `https://panel.theiragency.com`: the certificate is issued on the first visit and the
   login page shows their brand.

Certificates are only issued for domains saved on an account, so nobody else can point a domain at
the server and get one.

## Backups

- Automatic every night at 02:30: database and campaign images in `/var/backups/webrand360`,
  kept 14 days. Log: `/var/log/webrand360-backup.log`.
- **Copy them off the server too** (another server, Google Drive with `rclone`, or S3). A backup on
  the same machine doesn't help if the machine is lost.
- Backup now: `sudo bash deploy/backup.sh`
- Restore: `sudo bash deploy/restore.sh /var/backups/webrand360/db_DATE.dump /var/backups/webrand360/uploads_DATE.tar.gz`

## Updating to a new version

```
cd /opt/webrand360 && sudo bash deploy/update.sh
```

It backs up first, downloads the new code, rebuilds and restarts. The database updates itself.
The panel is unavailable for about a minute during the restart.

## Day to day

```
cd /opt/webrand360
alias dc='docker compose -f docker-compose.prod.yml --env-file .env.production'
dc ps                 # everything should be "running" / "healthy"
dc logs -f api        # API log (Ctrl+C to leave)
dc logs -f caddy      # certificates and web traffic
dc restart api        # after changing .env.production
df -h /               # disk space
```

## Security habits

- Only 1-2 people have server access, with SSH keys. Turn off password login for SSH once keys work.
- Ubuntu installs security updates by itself (`unattended-upgrades`). Reboot monthly.
- The database is not reachable from the internet; only the API talks to it.
- Wrong passwords are slowed down (8 tries per username, 30 per address, per 15 minutes).
  Changing a password logs out all other devices.
- **Masters → Activity log** shows every login, wrong password and change, with the IP address.
- If the Meta token or `.env.production` may have leaked: create a new system user token in Meta,
  put it in `.env.production`, run `dc restart api`. **Never change `ENCRYPTION_KEY`** - saved
  WhatsApp numbers would stop working.

## When something goes wrong

| What you see | What to check |
|---|---|
| Page doesn't load | DNS points to the server (`ping app.webrand360.com`); `dc ps` shows caddy running; ports 80/443 open (`ufw status`) |
| Browser warns about the certificate | DNS was wrong when Caddy first tried; fix DNS, then `dc restart caddy` and wait a minute |
| API keeps restarting | `dc logs api` - on a settings problem it says exactly which line of `.env.production` to fix |
| Meta says the webhook can't be verified | URL ends in `/api/webhooks/meta`; verify token matches `META_VERIFY_TOKEN` exactly |
| Messages fail with a token error | The Meta system user token expired or lost permissions: make a new one |
| Delivery reports never arrive | Webhook fields subscribed; `META_APP_SECRET` matches the app (Masters → Message log shows status) |
| Server is slow / disk full | `df -h`; old Docker images: `docker image prune -a`; upgrade to 4 vCPU / 8 GB |
