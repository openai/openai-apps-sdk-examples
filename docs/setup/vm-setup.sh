#!/bin/bash
# Generic VM Setup Script for MCP Server Development Environment
# Customize this script before running
#
# Required customizations:
#   - YOUR_DOMAIN - Your full domain (line 30, 56)
#   - YOUR_EMAIL - Your email for Let's Encrypt (line 56)
#   - CONFIG_FILE - Your nginx config filename (line 30-31)
#
# Usage:
#   1. Upload your nginx config to VM: scp your-config.conf user@vm:/tmp/
#   2. Upload this script to VM: scp vm-setup.sh user@vm:/tmp/
#   3. SSH to VM and run: sudo bash /tmp/vm-setup.sh

set -e

echo "==================================================="
echo "MCP Server - VM Setup"
echo "==================================================="
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo "Please run as root (use sudo)"
    exit 1
fi

# CUSTOMIZE THESE VARIABLES
DOMAIN="<YOUR_DOMAIN>"  # e.g., mcp.example.com
EMAIL="<YOUR_EMAIL>"     # e.g., you@example.com
CONFIG_FILE="<YOUR_CONFIG_FILENAME>"  # e.g., example-nginx-dev.conf

echo "Step 1: Installing nginx and certbot..."
apt-get update
apt-get install -y nginx certbot python3-certbot-nginx

echo ""
echo "Step 2: Copying nginx configuration..."
# Expecting the config file in /tmp/
if [ -f "/tmp/${CONFIG_FILE}" ]; then
    cp "/tmp/${CONFIG_FILE}" "/etc/nginx/sites-available/${DOMAIN}"
    ln -sf "/etc/nginx/sites-available/${DOMAIN}" /etc/nginx/sites-enabled/
else
    echo "ERROR: ${CONFIG_FILE} not found in /tmp/"
    echo "Please upload your nginx config to the VM first"
    exit 1
fi

echo ""
echo "Step 3: Testing nginx configuration..."
nginx -t

echo ""
echo "Step 4: Starting nginx..."
systemctl enable nginx
systemctl restart nginx

echo ""
echo "Step 5: Obtaining Let's Encrypt SSL certificate..."
echo "This will request a certificate for ${DOMAIN}"
echo "Email: ${EMAIL}"
echo ""

# Note: Remove --non-interactive if you want to review the prompts
certbot --nginx -d "${DOMAIN}" --non-interactive --agree-tos --email "${EMAIL}"

echo ""
echo "==================================================="
echo "VM Setup Complete!"
echo "==================================================="
echo ""
echo "Next steps:"
echo "1. Ensure DNS A record points ${DOMAIN} to this VM"
echo "2. On your local machine, set up the SSH reverse tunnel"
echo "3. Start your MCP server locally"
echo "4. Test with: curl https://${DOMAIN}/mcp"
echo ""
