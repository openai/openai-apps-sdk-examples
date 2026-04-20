# MCP Server Development Environment Setup Guide

> **Note:** This guide is for setting up a **development environment** to test your MCP server with ChatGPT. For production deployment, see [`../DEPLOYMENT.md`](../DEPLOYMENT.md).

This guide will help you set up your MCP server to be accessible via ChatGPT using SSH reverse tunneling through a VM with nginx. This approach avoids SSE buffering issues found in some cloud tunnel services.

## Architecture Overview

```
ChatGPT
    ↓ HTTPS
your-domain.com (VM)
    ├─ nginx (:443)
    │   ├─ /mcp → localhost:TUNNEL_PORT_1
    │   └─ /*   → localhost:TUNNEL_PORT_2 (optional, for assets)
    ↓ SSH Reverse Tunnel
Your Local Machine
    ├─ MCP Server (port MCP_PORT)
    └─ Asset Server (port ASSETS_PORT, optional)
```

## Prerequisites

- VM with public IP address
- Root/sudo access to the VM
- Domain name with DNS management access
- SSH access from your local machine to the VM
- SSH key pair for authentication

## Setup Steps

### 1. DNS Configuration

Add an A record for your subdomain:

```
Type: A
Name: <SUBDOMAIN> (e.g., mcp or your-app-name)
Value: <YOUR_VM_IP_ADDRESS>
TTL: 3600 (or default)
```

**Verify DNS propagation:**
```bash
dig <SUBDOMAIN>.<YOUR_DOMAIN>
# or
nslookup <SUBDOMAIN>.<YOUR_DOMAIN>
```

### 2. Firewall Configuration

Ensure your VM firewall allows:
- Port 22 (SSH) - For tunnel connection
- Port 80 (HTTP) - For Let's Encrypt validation
- Port 443 (HTTPS) - For ChatGPT access

**Check for cloud provider firewalls:**
Many cloud providers (AWS, GCP, Azure, Hetzner, etc.) have external firewalls separate from the VM's local firewall. Check your provider's dashboard.

### 3. VM Setup

**Step 3.1:** Install nginx and certbot:
```bash
ssh <USER>@<VM_IP>
sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx
```

**Step 3.2:** Create nginx configuration with SSE support:

See [`example-nginx-dev.conf`](example-nginx-dev.conf) for a template. Key points:
- Proxy `/mcp` path to your MCP server tunnel port
- Disable buffering for SSE (`proxy_buffering off`, `proxy_cache off`)
- Use HTTP/1.1 and clear Connection header
- Optional: proxy root `/` to assets server tunnel port

Copy your config to nginx:
```bash
sudo cp /path/to/your-config.conf /etc/nginx/sites-available/<your-domain>
sudo ln -s /etc/nginx/sites-available/<your-domain> /etc/nginx/sites-enabled/
sudo nginx -t  # Test configuration
```

**Step 3.3:** Obtain SSL certificate:

**Important:** nginx cannot start with SSL config if certificates don't exist yet. Use this approach:

```bash
# First, deploy a temporary HTTP-only config (see example-nginx-temp.conf)
sudo cp example-nginx-temp.conf /etc/nginx/sites-available/<your-domain>
sudo ln -s /etc/nginx/sites-available/<your-domain> /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# Obtain certificate
sudo certbot --nginx -d <SUBDOMAIN>.<YOUR_DOMAIN>

# Then deploy your full HTTPS config
sudo cp your-full-config.conf /etc/nginx/sites-available/<your-domain>
sudo nginx -t && sudo systemctl reload nginx
```

**Note:** You'll need to provide your email for Let's Encrypt certificate registration.

### 4. CAA DNS Record (if using Let's Encrypt)

Let's Encrypt requires CAA record allowing `letsencrypt.org` (NOT `.com`):

**Check existing CAA:**
```bash
dig CAA <YOUR_DOMAIN>
```

**Add if needed:**
```
Type: CAA
Name: @ (or <YOUR_DOMAIN>)
Tag: issue
Value: letsencrypt.org
```

### 5. SSH Reverse Tunnel Setup (Local Machine)

**Step 5.1:** Ensure you have SSH key access to your VM:
```bash
ssh-copy-id <USER>@<VM_IP>
# or manually copy your public key to ~/.ssh/authorized_keys on the VM
```

**Step 5.2:** Test the SSH tunnel manually:
```bash
# Single-server architecture (MCP only)
ssh -N -R <TUNNEL_PORT_1>:localhost:<MCP_PORT> <USER>@<VM_IP>

# Two-server architecture (MCP + assets)
ssh -N -R <TUNNEL_PORT_1>:localhost:<MCP_PORT> \
        -R <TUNNEL_PORT_2>:localhost:<ASSETS_PORT> \
        <USER>@<VM_IP>
```

**Step 5.3:** Set up systemd service for persistent tunnel (recommended):

See [`example-tunnel.service`](example-tunnel.service) for a template. Customize:
- `<USER>` - Your VM username
- `<VM_HOST>` - Your VM IP or hostname
- `<SSH_KEY_PATH>` - Path to your SSH private key
- `<TUNNEL_PORT_1>`, `<MCP_PORT>` - Your port numbers
- Add second `-R` flag if using two-server architecture

Install the service:
```bash
sudo cp your-tunnel.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable your-tunnel.service
sudo systemctl start your-tunnel.service
```

**Step 5.4:** Check tunnel status:
```bash
sudo systemctl status your-tunnel
sudo journalctl -u your-tunnel -f
```

Verify ports are listening on VM:
```bash
ssh <USER>@<VM_IP> 'ss -tlnp | grep -E "<TUNNEL_PORT_1>|<TUNNEL_PORT_2>"'
```

### 6. Start Your MCP Server

Start your MCP server locally:
```bash
cd <your_mcp_server_directory>
<your_start_command>  # e.g., pnpm start, npm start, python main.py
```

If using two-server architecture, also start your asset server:
```bash
<your_assets_command>  # e.g., pnpm run serve
```

### 7. Testing

**Step 7.1:** Test the MCP endpoint:
```bash
curl https://<SUBDOMAIN>.<YOUR_DOMAIN>/mcp
# Should see SSE event stream starting
```

**Step 7.2:** Run MCP protocol tests (if available):
```bash
MCP_URL=https://<SUBDOMAIN>.<YOUR_DOMAIN>/mcp pnpm exec tsx tests/test-mcp.ts
```

**Step 7.3:** Test in ChatGPT:
1. Go to ChatGPT → Settings → Add MCP Server
2. Enter URL: `https://<SUBDOMAIN>.<YOUR_DOMAIN>/mcp`
3. Invoke a tool from your MCP server
4. Verify widgets render correctly (if applicable)

## Troubleshooting

### SSH Tunnel Not Working

Check the tunnel status:
```bash
sudo systemctl status your-tunnel
sudo journalctl -u your-tunnel -f
```

Ensure tunnel ports are listening on the VM:
```bash
ssh <USER>@<VM_IP> 'ss -tlnp | grep -E "<TUNNEL_PORT>"'
```

### Port Conflicts on VM

If your tunnel ports conflict with existing services:
```bash
ssh <USER>@<VM_IP> 'sudo lsof -i:<PORT>'
```

Choose different high ports (9000+) that are available.

### nginx Errors

Check nginx logs on the VM:
```bash
ssh <USER>@<VM_IP> 'sudo tail -f /var/log/nginx/error.log'
```

Test nginx configuration:
```bash
ssh <USER>@<VM_IP> 'sudo nginx -t'
```

Common issues:
- **502 Bad Gateway**: Tunnel not active or wrong port
- **SSL errors**: Certificate path incorrect or doesn't exist

### SSL Certificate Issues

Check certificate status:
```bash
ssh <USER>@<VM_IP> 'sudo certbot certificates'
```

Renew certificate manually:
```bash
ssh <USER>@<VM_IP> 'sudo certbot renew'
```

### MCP Connection Failing

Verify local servers are running:
```bash
curl http://localhost:<MCP_PORT>/mcp
```

Check firewall rules (VM and cloud provider).

## Scaling to Multiple Apps

To add another MCP server on the same VM:

1. Create DNS record: `<app2-subdomain>.<YOUR_DOMAIN> → VM_IP`
2. Create new nginx config with different tunnel ports
3. Obtain SSL certificate: `sudo certbot --nginx -d <app2-subdomain>.<YOUR_DOMAIN>`
4. Add ports to SSH tunnel or create separate tunnel service
5. Start your second MCP server on different local port

## Files in This Directory

- `example-nginx-dev.conf` - Example nginx configuration with SSE support
- `example-nginx-temp.conf` - Temporary HTTP-only config for SSL setup
- `example-tunnel.service` - Systemd service template for SSH tunnel
- `vm-setup.sh` - Example automated VM setup script
- `README.md` - This file

## Architecture Notes

**Why SSH Tunnel?**
- Avoids SSE buffering issues with some cloud tunnel services
- No additional cost (uses existing VM)
- Full control over nginx configuration
- Easily reproducible for multiple apps
- Encrypted connection

**Security Considerations:**
- SSH tunnel is encrypted end-to-end
- nginx handles SSL termination with Let's Encrypt
- Tunnel ports only listen on 127.0.0.1 (not exposed to internet)
- Let's Encrypt provides free, auto-renewing certificates
- Firewall limits access to SSH, HTTP, and HTTPS ports only

---

## Example: Pizzaz MCP Server Setup

The pizzaz MCP server uses a two-server architecture. Here's the specific configuration:

### Ports
- **Local MCP Server**: 8000
- **Local Asset Server**: 4444
- **VM Tunnel Port 1**: 9080 (forwards to MCP)
- **VM Tunnel Port 2**: 9081 (forwards to assets)
- **Domain**: pizzaz.lazzloe.com

### Build Command
```bash
BASE_URL=https://pizzaz.lazzloe.com pnpm run build
```

### Start Commands
```bash
# Terminal 1: MCP Server
cd pizzaz_server_node && pnpm start

# Terminal 2: Asset Server
pnpm -w run serve
```

### SSH Tunnel
```bash
ssh -f -N \
  -R 9080:localhost:8000 \
  -R 9081:localhost:4444 \
  ubuntu@<VM_IP>
```

### nginx Configuration
See the original `setup/nginx-pizzaz.conf` for the pizzaz-specific implementation.

### Testing
```bash
MCP_URL=https://pizzaz.lazzloe.com/mcp pnpm exec tsx tests/test-mcp.ts
```
