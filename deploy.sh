#!/usr/bin/env bash
set -euo pipefail

echo "🔨 Building project..."
npm run build

echo "📦 Deploying to isolate/..."
# Remove old built assets (they have different hash names each build)
rm -rf isolate/assets isolate/index.html

# Copy new build output
cp -r dist/* isolate/

echo ""
echo "✅ Deploy concluído!"
echo "   Os arquivos em isolate/ estão atualizados e prontos para deploy."
echo "   Preview: http://localhost:4173 (node serve-preview.cjs)"
