#!/bin/bash

# Staging Deployment Script
# This script deploys to staging environment with production-like behavior

set -e

echo "🚀 Starting staging deployment..."

# Configuration
STAGING_HOST="${STAGING_HOST:-your-staging-host.com}"
STAGING_USER="${STAGING_USER:-deploy}"
STAGING_PATH="${STAGING_PATH:-/home/deployer/market}"
SERVICE_NAME=""

# Build the application
echo "📦 Building application..."
bun run generate-routes
bun run build

# Create deployment package
echo "📋 Creating deployment package..."
DEPLOY_DIR="deploy-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$DEPLOY_DIR"

# Copy necessary files
bash scripts/package/make.sh . "$DEPLOY_DIR"

# Create staging-specific package.json script
cat > "$DEPLOY_DIR/package-staging.json" << 'EOF'
{
  "scripts": {
    "start:staging": "NODE_ENV=production bun src/index.tsx"
  }
}
EOF

# Deploy to staging server
echo "🚀 Deploying to staging server..."
rsync -avz --delete "$DEPLOY_DIR/" "$STAGING_USER@$STAGING_HOST:$STAGING_PATH/"

# Restart staging service
echo "🔄 Restarting staging service..."
ssh "$STAGING_USER@$STAGING_HOST" << EOF
  cd $STAGING_PATH
  
  # Install dependencies if needed
  bun install --production
  
  # Stop service
  sudo systemctl stop $SERVICE_NAME || true
  
  # Start service
  sudo systemctl start $SERVICE_NAME
  
  # Check status
  sudo systemctl status $SERVICE_NAME --no-pager
EOF

# Cleanup
rm -rf "$DEPLOY_DIR"

echo "✅ Staging deployment completed!"
echo "🌐 Staging URL: https://$STAGING_HOST"
