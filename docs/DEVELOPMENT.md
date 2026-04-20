# Development Environment Setup for ChatGPT MCP Integration

This guide documents how to set up a **development environment** to test your MCP (Model Context Protocol) server with ChatGPT. This is NOT a production deployment guide.

## Overview

To integrate your local MCP server with ChatGPT, you need to expose it over HTTPS. ChatGPT requires:
- HTTPS endpoint (not HTTP)
- Support for Server-Sent Events (SSE)
- Publicly accessible URL

## Common MCP Server Architectures

MCP servers can be structured in different ways depending on your needs:

### Single-Server Architecture
- **MCP Server**: One server handling both MCP protocol and serving assets
- Simple to set up and maintain
- Suitable for servers with minimal asset requirements

### Two-Server Architecture
- **MCP Server**: Implements the MCP protocol over SSE
- **Asset Server**: Static file server for widget JavaScript, CSS, and images
- Allows independent scaling and caching strategies
- Widget HTML references asset server URLs (configured via environment variables)

## Tunneling Approaches for Development

When developing locally, you need to expose your MCP server to the internet. Here are three approaches we've evaluated:

### Approach 1: ngrok (Free Tier) ❌

**Why Try It:** Popular, easy to use, free tier available

**Limitations:**
- Free tier shows an interstitial warning page for browser user-agents
- This warning page blocks ChatGPT from connecting to the MCP endpoint
- Paid tier would work, but not suitable for free development

**Command:**
```bash
ngrok http <MCP_PORT>
```

**Result:** Connection blocked by warning page

---

### Approach 2: Cloudflare Tunnels ❌

**Why Try It:** Free, no interstitial pages, official Cloudflare product

**Limitations:**
- Cloudflare Tunnels **buffer GET requests** including SSE streams
- The MCP protocol relies on SSE (Server-Sent Events) for real-time communication
- Even with `X-Accel-Buffering: no` header, buffering persists
- Known issue: https://github.com/cloudflare/cloudflared/issues/1449

**Commands:**
```bash
# Quick tunnels (temporary URLs)
cloudflared tunnel --url http://localhost:<MCP_PORT>

# Named tunnels (requires domain)
cloudflared tunnel create mcp-tunnel
cloudflared tunnel route dns mcp-tunnel mcp.yourdomain.com
cloudflared tunnel run mcp-tunnel
```

**Result:** SSE buffering prevents MCP from working

---

### Approach 3: SSH Reverse Tunnel + nginx ✅ **RECOMMENDED**

**Why This Works:**
- No SSE buffering issues
- Full control over nginx configuration
- Uses existing VM infrastructure (no additional cost)
- Professional SSL setup with Let's Encrypt

**Architecture:**
```
Local Machine                    VM (your-domain.com)             Internet
───────────────                  ────────────────────             ────────
MCP Server  ────┐                ┌→ localhost:TUNNEL_PORT_1
                │                │
                SSH Tunnel ──────┤                                ChatGPT
                │                │                                ↓
Assets (opt)────┘                └→ localhost:TUNNEL_PORT_2       HTTPS:443
                                         ↓                         ↓
                                      nginx ←───────────────────────
                                   (routes by path)
```

**How It Works:**

1. **SSH Reverse Tunnel** forwards local ports to VM:
   ```bash
   ssh -f -N \
     -R <TUNNEL_PORT_1>:localhost:<MCP_PORT> \
     -R <TUNNEL_PORT_2>:localhost:<ASSETS_PORT> \
     <USER>@<VM_IP>
   ```
   - `-R <TUNNEL_PORT_1>:localhost:<MCP_PORT>`: VM port forwards to your MCP server
   - `-R <TUNNEL_PORT_2>:localhost:<ASSETS_PORT>`: VM port forwards to your assets (if using two-server architecture)
   - Tunnel ports only listen on localhost (127.0.0.1) on the VM for security

2. **nginx** on VM handles SSL termination and routing:
   ```nginx
   location /mcp {
       proxy_pass http://127.0.0.1:<TUNNEL_PORT_1>;
       proxy_buffering off;  # Critical for SSE
       proxy_cache off;
       # ... SSE-specific settings (see docs/setup/README.md)
   }

   location / {
       proxy_pass http://127.0.0.1:<TUNNEL_PORT_2>;  # Assets (if applicable)
   }
   ```

3. **Let's Encrypt** provides free SSL certificate
4. **DNS** points your domain to VM IP

## Setup Instructions

Detailed step-by-step instructions are in [`docs/setup/README.md`](setup/README.md), including:
- DNS configuration
- Firewall setup (ports 22, 80, 443)
- nginx installation and configuration
- SSL certificate acquisition with certbot
- SSH tunnel service setup for persistence

## Quick Start (Assuming VM is Ready)

```bash
# 1. Start your MCP server locally
cd <your_mcp_server> && <start_command>  # e.g., pnpm start

# 2. (Optional) Start asset server if using two-server architecture
<start_assets_command>  # e.g., pnpm run serve

# 3. Create SSH tunnel
ssh -f -N \
  -R <TUNNEL_PORT_1>:localhost:<MCP_PORT> \
  -R <TUNNEL_PORT_2>:localhost:<ASSETS_PORT> \
  <USER>@<VM_IP>

# 4. Test MCP endpoint
MCP_URL=https://<YOUR_DOMAIN>/mcp pnpm exec tsx tests/test-mcp.ts

# 5. Add to ChatGPT
# Go to ChatGPT → Settings → Add MCP Server → https://<YOUR_DOMAIN>/mcp
```

## Lessons Learned

### Port Conflicts
- VMs may have services using common ports (8080, 8081, etc.)
- Check before choosing tunnel ports: `ssh <USER>@<VM_IP> 'sudo lsof -i:<PORT>'`
- Choose unused high ports (9000+) to avoid conflicts

### CAA DNS Records
- Let's Encrypt requires CAA record allowing `letsencrypt.org` (not `.com`)
- Check existing CAA: `dig CAA yourdomain.com`
- Add if needed:
  ```
  Type: CAA
  Name: @ (or yourdomain.com)
  Tag: issue
  Value: letsencrypt.org
  ```

### Firewall Configuration
- Cloud providers often have external firewalls (check your provider's dashboard)
- Required ports:
  - 22 (SSH) - For tunnel connection
  - 80 (HTTP) - For Let's Encrypt validation
  - 443 (HTTPS) - For ChatGPT access
- Tunnel ports should NOT be exposed publicly (only listen on 127.0.0.1)

### SSL Certificate Setup
- nginx config can't reference non-existent SSL certs
- Deploy temporary HTTP-only config first
- Get certificate with certbot
- Then deploy production HTTPS config

### SSE Requirements
Critical nginx settings for SSE:
```nginx
proxy_buffering off;
proxy_cache off;
proxy_set_header Connection '';
chunked_transfer_encoding off;
proxy_http_version 1.1;
```

## Testing

Run MCP protocol tests:
```bash
# Local (if your MCP server runs locally)
pnpm exec tsx tests/test-mcp.ts

# Remote (through tunnel)
MCP_URL=https://<YOUR_DOMAIN>/mcp pnpm exec tsx tests/test-mcp.ts
```

See [`tests/README.md`](../tests/README.md) for detailed testing documentation.

## Troubleshooting

### SSH Tunnel Disconnects
- Use autossh or systemd service for persistence
- Check `docs/setup/example-tunnel.service` for systemd template
- Verify tunnel: `ps aux | grep ssh | grep <TUNNEL_PORT>`

### nginx 502 Bad Gateway
- Verify SSH tunnel is active: `ps aux | grep ssh`
- Check tunnel ports on VM: `ssh <USER>@<VM_IP> 'ss -tlnp | grep -E "<PORT1>|<PORT2>"'`
- Restart tunnel if needed

### ChatGPT Can't Connect
- Test endpoint: `curl https://<YOUR_DOMAIN>/mcp`
- Should see SSE event stream starting
- Check nginx logs: `ssh <USER>@<VM_IP> 'sudo tail -f /var/log/nginx/error.log'`

### Widget Assets Don't Load
- Check if asset URLs are correctly embedded in your build output
- Verify asset server is running: `lsof -i:<ASSETS_PORT>`
- Test asset URL directly: `curl https://<YOUR_DOMAIN>/path/to/asset.html`

## Security Notes

- SSH tunnel is encrypted end-to-end
- Tunnel ports only listen on localhost (not exposed to internet)
- nginx handles SSL termination with Let's Encrypt certificates
- Firewall only exposes ports 22, 80, 443
- Consider adding authentication if your MCP server handles sensitive data

## What's Next?

This setup is for **development and testing only**. For production deployment:
- See [`docs/DEPLOYMENT.md`](DEPLOYMENT.md) for production guidelines
- Set up monitoring and logging
- Implement rate limiting
- Use process managers (PM2, systemd) for server persistence
- Regular security updates
- Backup and disaster recovery planning

## Files Reference

- `docs/setup/` - Example nginx configs, systemd services, and setup scripts
- `tests/` - MCP protocol test suite
- Your MCP server implementation files

---

## Appendix: Pizzaz Example Implementation

The **pizzaz** MCP server is a concrete example from this repository that uses the two-server architecture. Here's how it implements the concepts above:

### Architecture

The pizzaz implementation uses two separate servers:

1. **MCP Server** (port 8000): Node.js server implementing MCP protocol
   - Located in `pizzaz_server_node/`
   - Reads widget HTML from filesystem
   - Serves via SSE to ChatGPT
   - Returns `structuredContent` for widget rendering

2. **Asset Server** (port 4444): Static file server
   - Serves JavaScript, CSS, and images
   - Widget HTML embeds URLs pointing to this server
   - Uses `serve` package for simple HTTP serving

The `BASE_URL` environment variable (embedded during build) connects them:
```bash
BASE_URL=https://pizzaz.lazzloe.com pnpm run build
```

This embeds the production URL into the widget HTML for asset loading.

### Quick Start for Pizzaz

```bash
# 1. Build widgets with your domain
BASE_URL=https://<YOUR_DOMAIN> pnpm run build

# 2. Start local servers
cd pizzaz_server_node && pnpm start  # Terminal 1 (port 8000)
pnpm -w run serve                     # Terminal 2 (port 4444)

# 3. Start SSH tunnel (example using ports 9080/9081)
ssh -f -N \
  -R 9080:localhost:8000 \
  -R 9081:localhost:4444 \
  ubuntu@<VM_IP>

# 4. Test MCP endpoint
MCP_URL=https://<YOUR_DOMAIN>/mcp pnpm exec tsx tests/test-mcp.ts

# 5. Add to ChatGPT
# Go to ChatGPT → Settings → Add MCP Server → https://<YOUR_DOMAIN>/mcp
```

### Pizzaz-Specific Files

- `pizzaz_server_node/src/server.ts` - MCP server implementation
- `build-all.mts` - Widget build script (embeds BASE_URL)
- `src/pizzaz*/` - Widget source code
- `assets/` - Generated HTML, JS, and CSS bundles

### Port Configuration Note

The example uses ports 9080/9081 for tunneling to avoid conflicts with common services that might be running on the VM (like web servers on 8080/8081).
