# MCP Server - Production Deployment Guide

This guide covers deploying MCP servers from this repository to production. This assumes you're deploying to a VM with systemd services, nginx reverse proxy, and Let's Encrypt SSL.

> **Note:** This guide is for **production deployment**. For development/testing with local servers, see [`DEVELOPMENT.md`](DEVELOPMENT.md).

## Overview

Production deployment differs from development setup:
- **Development**: SSH tunnels from local machine → VM
- **Production**: Code runs directly on VM, managed by systemd

## Prerequisites

- VM with Ubuntu (tested on Ubuntu 20.04+)
- Domain name with DNS configured
- SSH access to the VM
- Node.js 18+ and pnpm installed on the VM (or Python 3.10+ for Python servers)
- SSL certificate (Let's Encrypt recommended)

## Architecture

```
Internet → HTTPS:443 → nginx → localhost:MCP_PORT (MCP Server)
                            → localhost:ASSETS_PORT (Assets, optional)
```

**Key Components:**
- **MCP Server**: Implements MCP protocol over SSE
- **Assets Server** (optional): Static file server for widget bundles
- **nginx**: Reverse proxy with SSL termination and SSE optimization
- **systemd**: Service management with auto-restart on failure

## Initial Setup (One-time)

### 1. DNS Configuration

Point your domain to your VM:
```
Type: A
Name: <SUBDOMAIN> (e.g., mcp or your-app-name)
Value: <VM_IP_ADDRESS>
TTL: 3600 (or default)
```

### 2. Firewall Configuration

Ensure ports are open:
- **22** (SSH) - For deployment access
- **80** (HTTP) - For Let's Encrypt validation
- **443** (HTTPS) - For ChatGPT/user access

Check both VM firewall (`ufw`, `iptables`) and cloud provider firewalls.

### 3. SSL Certificate

Obtain Let's Encrypt certificate:
```bash
ssh <USER>@<VM_IP>
sudo apt update && sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d <YOUR_DOMAIN>
```

### 4. nginx Configuration

See [`docs/setup/example-nginx-production.conf`](setup/example-nginx-production.conf) for a template.

Key requirements:
- Proxy `/mcp` → your MCP server port
- Disable buffering for SSE support
- Optional: proxy `/` → assets server port
- SSL configuration with Let's Encrypt certificates

Copy config to nginx:
```bash
sudo cp your-config.conf /etc/nginx/sites-available/<YOUR_DOMAIN>
sudo ln -s /etc/nginx/sites-available/<YOUR_DOMAIN> /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### 5. Application Directory

Create deployment directory on VM:
```bash
ssh <USER>@<VM_IP>
sudo mkdir -p /opt/<your-app-name>
sudo chown <USER>:<USER> /opt/<your-app-name>
```

## Deployment Process

### Option 1: Using Deployment Script (Recommended)

See [`docs/scripts/deploy-example.sh`](scripts/deploy-example.sh) for a template deployment script.

The script should:
1. Build assets locally (if applicable)
2. Sync code to VM (rsync)
3. Install dependencies on VM
4. Update systemd service files
5. Restart services
6. Verify health

Customize and run:
```bash
./scripts/deploy-your-app.sh
```

### Option 2: Manual Deployment

```bash
# 1. Build assets locally (if applicable)
BASE_URL=https://<YOUR_DOMAIN> pnpm run build

# 2. Sync code to VM
rsync -avz --delete \
  --exclude 'node_modules' \
  --exclude '.git' \
  --exclude '.env' \
  ./ <USER>@<VM_IP>:/opt/<your-app-name>/

# 3. Install dependencies on VM
ssh <USER>@<VM_IP> "cd /opt/<your-app-name> && pnpm install --prod"

# 4. Copy systemd service files
scp setup/<your-app>-mcp.service <USER>@<VM_IP>:/tmp/
ssh <USER>@<VM_IP> "
  sudo cp /tmp/<your-app>-mcp.service /etc/systemd/system/ &&
  sudo systemctl daemon-reload &&
  sudo systemctl enable <your-app>-mcp.service &&
  sudo systemctl restart <your-app>-mcp.service
"

# 5. Verify
curl https://<YOUR_DOMAIN>/mcp
```

## Service Management

### Check Service Status

```bash
ssh <USER>@<VM_IP> 'sudo systemctl status <your-app>-mcp.service'
```

### View Logs

```bash
# Follow logs in real-time
ssh <USER>@<VM_IP> 'sudo journalctl -u <your-app>-mcp.service -f'

# View recent logs
ssh <USER>@<VM_IP> 'sudo journalctl -u <your-app>-mcp.service -n 50 --no-pager'
```

### Restart Services

```bash
ssh <USER>@<VM_IP> 'sudo systemctl restart <your-app>-mcp.service'
```

### Stop Services

```bash
ssh <USER>@<VM_IP> 'sudo systemctl stop <your-app>-mcp.service'
```

## systemd Service Files

See [`docs/setup/example-mcp.service`](setup/example-mcp.service) and [`docs/setup/example-assets.service`](setup/example-assets.service) for templates.

Key features:
- `Restart=always` - Auto-restart on failure
- `RestartSec=10` - Wait 10s before restart
- `WorkingDirectory` - Set to your app directory
- `Environment` - Set environment variables (BASE_URL, PORT, etc.)
- `StandardOutput=journal` - Logs to journalctl

## nginx Production Configuration

Critical SSE settings:
```nginx
location /mcp {
    proxy_pass http://127.0.0.1:<MCP_PORT>;
    proxy_buffering off;  # Critical for SSE
    proxy_cache off;
    proxy_set_header Connection '';
    chunked_transfer_encoding off;
    proxy_http_version 1.1;
    proxy_read_timeout 3600s;  # Long timeout for SSE
}
```

## Testing

### Run Protocol Tests

If your MCP server has tests:
```bash
MCP_URL=https://<YOUR_DOMAIN>/mcp pnpm exec tsx tests/test-mcp.ts
```

### Manual Testing

```bash
# Test MCP endpoint (should return SSE stream)
curl https://<YOUR_DOMAIN>/mcp

# Test in ChatGPT
# Go to ChatGPT → Settings → Add MCP Server → https://<YOUR_DOMAIN>/mcp
```

## Troubleshooting

### Service Won't Start

Check logs for errors:
```bash
ssh <USER>@<VM_IP> 'sudo journalctl -u <your-app>-mcp.service -n 50'
```

Common issues:
- **Port already in use**: Check `sudo lsof -i:<PORT>`
- **Missing dependencies**: Run `pnpm install` in app directory
- **Missing environment variables**: Check `Environment=` in service file
- **Wrong working directory**: Verify `WorkingDirectory=` in service file

### nginx 502 Bad Gateway

- Service not running: Check `sudo systemctl status <your-app>-mcp.service`
- Wrong port in config: Verify nginx proxy_pass port matches service port
- Firewall blocking: Check VM and cloud provider firewalls

### SSE Connection Issues

- nginx buffering: Ensure `proxy_buffering off` in nginx config
- Timeout too short: Increase `proxy_read_timeout` in nginx config
- Check server logs for connection errors

### Assets Don't Load (Two-Server Architecture)

- Verify BASE_URL was set during build
- Check assets service is running
- Test asset URL directly: `curl https://<YOUR_DOMAIN>/asset.html`

## Rollback

If deployment fails:

```bash
# 1. Check git history on your machine
git log --oneline

# 2. Checkout previous commit
git checkout <previous-commit>

# 3. Redeploy
./scripts/deploy-your-app.sh
```

Or on VM, restart previous version if code still exists:
```bash
ssh <USER>@<VM_IP> 'sudo systemctl restart <your-app>-mcp.service'
```

## Port Configuration

**Choosing ports:**
- Use high ports (8000+) to avoid conflicts
- Check if port is available: `ssh <USER>@<VM_IP> 'sudo lsof -i:<PORT>'`
- Document your port choices in your systemd service files

## Security Considerations

**Current setup:**
- ✅ HTTPS with Let's Encrypt SSL
- ✅ Auto-restart on crash (systemd)
- ✅ Logging to journalctl
- ⚠️ No authentication (MCP server is public by default)
- ⚠️ No rate limiting
- ⚠️ No monitoring/alerts

**Production hardening recommendations:**
- Add rate limiting in nginx
- Implement authentication if handling sensitive data
- Set up monitoring (UptimeRobot, Prometheus, etc.)
- Configure log rotation
- Regular security updates (`apt update && apt upgrade`)
- Backup strategy for application data
- Set up alerts for service failures

## Monitoring

### Basic Health Checks

```bash
# Check if MCP endpoint responds
curl -f https://<YOUR_DOMAIN>/mcp || echo "MCP endpoint down"

# Check service status
ssh <USER>@<VM_IP> 'systemctl is-active <your-app>-mcp.service'
```

### Log Monitoring

Set up log alerts:
```bash
# Watch for errors
ssh <USER>@<VM_IP> 'sudo journalctl -u <your-app>-mcp.service -f | grep -i error'
```

## Multiple Apps on Same VM

To run multiple MCP servers on the same VM:

1. **Use different ports** for each app
2. **Create separate systemd services** with unique names
3. **Add nginx location blocks** for each app:
   ```nginx
   server {
       server_name app1.example.com;
       location /mcp { proxy_pass http://127.0.0.1:8001; }
   }

   server {
       server_name app2.example.com;
       location /mcp { proxy_pass http://127.0.0.1:8002; }
   }
   ```
4. **Obtain SSL certificates** for each domain
5. **Deploy to separate directories**: `/opt/app1/`, `/opt/app2/`

## Files Reference

- [`docs/setup/example-nginx-production.conf`](setup/example-nginx-production.conf) - Example nginx config
- [`docs/setup/example-mcp.service`](setup/example-mcp.service) - Example systemd service for MCP server
- [`docs/setup/example-assets.service`](setup/example-assets.service) - Example systemd service for assets
- [`docs/scripts/deploy-example.sh`](scripts/deploy-example.sh) - Example deployment script

---

## Appendix: Pizzaz Production Deployment Example

The **pizzaz** MCP server is deployed at `https://pizzaz.lazzloe.com/mcp` using this architecture.

### Configuration

**Domain**: pizzaz.lazzloe.com
**VM**: Ubuntu 20.04 at 46.224.27.7
**Deploy Directory**: `/opt/pizzaz-mcp/`

**Ports:**
- MCP Server: 8001 (port 8000 was occupied by another service)
- Assets Server: 4444

### Services

- `pizzaz-mcp.service` - MCP server
- `pizzaz-assets.service` - Static assets server

### Deployment

```bash
# Automated deployment
./scripts/deploy-pizzaz.sh

# Manual check
ssh ubuntu@46.224.27.7 'sudo systemctl status pizzaz-mcp.service'
```

### Build Command

```bash
BASE_URL=https://pizzaz.lazzloe.com pnpm run build
```

### Testing

```bash
MCP_URL=https://pizzaz.lazzloe.com/mcp pnpm exec tsx tests/test-mcp.ts
```

### Files

- `scripts/deploy-pizzaz.sh` - Deployment automation
- `setup/pizzaz-mcp.service` - MCP service config
- `setup/pizzaz-assets.service` - Assets service config
- `setup/nginx-pizzaz-production.conf` - nginx configuration
