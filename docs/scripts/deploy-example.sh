#!/bin/bash
# Example deployment script for MCP server to production
#
# Customize the following variables for your app:
#   - VM_HOST: SSH connection string (user@ip or user@hostname)
#   - DEPLOY_DIR: Directory on VM where app will be deployed
#   - BASE_URL: Your production domain URL (if building assets)
#   - PNPM or NODE: Path to pnpm/node on VM (if using Node.js)
#   - SERVICE_NAMES: Your systemd service names
#   - MCP_PORT: Port your MCP server runs on
#   - NGINX_CONF: Your nginx config filename
#
# Usage: ./deploy-example.sh

set -e

# ============ CONFIGURATION - CUSTOMIZE THESE ============
VM_HOST="<USER>@<VM_IP>"              # e.g., ubuntu@192.168.1.100
DEPLOY_DIR="/opt/<your-app-name>"     # e.g., /opt/my-mcp-server
BASE_URL="https://<YOUR_DOMAIN>"      # e.g., https://mcp.example.com
PNPM="/path/to/pnpm"                  # e.g., /home/ubuntu/.local/share/pnpm/pnpm
MCP_SERVICE="<your-app>-mcp.service"  # e.g., my-app-mcp.service
ASSETS_SERVICE="<your-app>-assets.service"  # Optional, remove if single-server
MCP_PORT="<MCP_PORT>"                 # e.g., 8001
NGINX_CONF="<your-nginx-conf>"        # e.g., example-nginx-production.conf
NGINX_SITE="<YOUR_DOMAIN>"            # e.g., mcp.example.com
# =========================================================

echo "🚀 Starting deployment to production..."

# Step 1: Build assets locally (if applicable)
echo ""
echo "📦 Building assets with BASE_URL=$BASE_URL..."
# Customize this for your build process:
# - Node.js with widgets: BASE_URL=$BASE_URL pnpm run build
# - Python: might not need this step
# - Static only: skip this step
BASE_URL=$BASE_URL pnpm run build

# Step 2: Create deployment directory on VM
echo ""
echo "📁 Creating deployment directory on VM..."
ssh $VM_HOST "sudo mkdir -p $DEPLOY_DIR && sudo chown $(whoami):$(whoami) $DEPLOY_DIR"

# Step 3: Copy files to VM
echo ""
echo "📤 Copying files to VM..."
rsync -avz --delete \
  --exclude 'node_modules' \
  --exclude '.git' \
  --exclude 'dist' \
  --exclude '.next' \
  --exclude '__pycache__' \
  --exclude '.env' \
  --exclude '.venv' \
  ./ $VM_HOST:$DEPLOY_DIR/

# Step 4: Install dependencies on VM
echo ""
echo "📥 Installing dependencies on VM..."
# Customize for your stack:
# - Node.js with pnpm: ssh $VM_HOST "cd $DEPLOY_DIR && $PNPM install --prod"
# - Node.js with npm: ssh $VM_HOST "cd $DEPLOY_DIR && npm install --production"
# - Python: ssh $VM_HOST "cd $DEPLOY_DIR && python3 -m pip install -r requirements.txt"
ssh $VM_HOST "cd $DEPLOY_DIR && $PNPM install --prod"

# If your MCP server is in a subdirectory:
# ssh $VM_HOST "cd $DEPLOY_DIR/<server-dir> && $PNPM install --prod"

# Step 5: Copy and enable systemd services
echo ""
echo "⚙️  Setting up systemd services..."
ssh $VM_HOST "sudo cp $DEPLOY_DIR/setup/$MCP_SERVICE /etc/systemd/system/"
# If using assets service (two-server architecture):
ssh $VM_HOST "sudo cp $DEPLOY_DIR/setup/$ASSETS_SERVICE /etc/systemd/system/"

ssh $VM_HOST "sudo systemctl daemon-reload"
ssh $VM_HOST "sudo systemctl enable $MCP_SERVICE"
# If using assets service:
ssh $VM_HOST "sudo systemctl enable $ASSETS_SERVICE"

# Step 6: Update nginx configuration
echo ""
echo "🌐 Updating nginx configuration..."
ssh $VM_HOST "sudo cp $DEPLOY_DIR/setup/$NGINX_CONF /etc/nginx/sites-available/$NGINX_SITE"
ssh $VM_HOST "sudo nginx -t"

# Step 7: Stop dev tunnel service if switching from dev to prod
echo ""
echo "🛑 Stopping dev tunnel service (if exists)..."
ssh $VM_HOST "sudo systemctl stop <your-app>-tunnel.service 2>/dev/null || true"
ssh $VM_HOST "sudo systemctl disable <your-app>-tunnel.service 2>/dev/null || true"

# Step 8: Restart services
echo ""
echo "🔄 Restarting services..."
ssh $VM_HOST "sudo systemctl restart $MCP_SERVICE"
# If using assets service:
ssh $VM_HOST "sudo systemctl restart $ASSETS_SERVICE"
ssh $VM_HOST "sudo systemctl reload nginx"

# Step 9: Check service status
echo ""
echo "✅ Checking service status..."
ssh $VM_HOST "sudo systemctl status $MCP_SERVICE --no-pager | head -10"
# If using assets service:
ssh $VM_HOST "sudo systemctl status $ASSETS_SERVICE --no-pager | head -10"

# Step 10: Wait and verify health
echo ""
echo "🔍 Verifying deployment..."
sleep 5
HTTP_CODE=$(ssh $VM_HOST "curl -s -o /dev/null -w '%{http_code}' http://localhost:$MCP_PORT/mcp")

if [ "$HTTP_CODE" = "200" ]; then
    echo "✅ MCP server responding correctly (HTTP $HTTP_CODE)"
else
    echo "❌ MCP server not responding correctly (HTTP $HTTP_CODE)"
    echo "Check logs with: ssh $VM_HOST sudo journalctl -u $MCP_SERVICE -n 50"
    exit 1
fi

echo ""
echo "🎉 Deployment complete!"
echo "🌐 MCP endpoint: $BASE_URL/mcp"
echo ""
echo "Useful commands:"
echo "  View MCP logs:    ssh $VM_HOST sudo journalctl -u $MCP_SERVICE -f"
echo "  Restart service:  ssh $VM_HOST sudo systemctl restart $MCP_SERVICE"
echo "  Check status:     ssh $VM_HOST sudo systemctl status $MCP_SERVICE"
