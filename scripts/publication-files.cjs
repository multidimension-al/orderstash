// Files deliberately included in the compiled extension and upload archive.
module.exports = {
  documents: ['README.md', 'PRIVACY.md', 'CONTRIBUTING.md',
    'SECURITY.md', 'CHANGELOG.md', 'LICENSE', 'NOTICE'],
  guides: ['USAGE.md', 'PERMISSIONS.md', 'DEVELOPMENT.md', 'TESTING.md'],
  assets: ['orderstash-logo-light.png', 'icon16.png', 'icon32.png', 'icon48.png', 'icon128.png'],
  brandAssets: ['orderstash-logo.png'],
  pages: ['panel.html', 'parser.html'],
  runtime: ['background.js', 'panel.js', 'parser.js', 'content.js', 'panel.css', 'manifest.json'],
  // Every Git-eligible path must match this public-source inventory.
  source: /^(?:README\.md|PRIVACY\.md|CONTRIBUTING\.md|SECURITY\.md|CHANGELOG\.md|LICENSE|NOTICE|package(?:-lock)?\.json|tsconfig\.json|jest\.config\.cjs|\.gitignore|\.gitattributes|\.editorconfig|docs\/(?:USAGE|PERMISSIONS|DEVELOPMENT|TESTING)\.md|docs\/brand\/orderstash-logo\.png|src\/(?:app\/[^/]+\.ts|invoices\/[^/]+\.ts|assets\/[^/]+\.png|pages\/[^/]+\.html|styles\/[^/]+\.css|manifest\.json)|scripts\/[^/]+\.cjs|tests\/[^/]+\.test\.ts|\.github\/workflows\/checks\.yml)$/,
  // Reject these even when force-added to Git; .gitignore alone cannot do that.
  privateSource: /(^|\/)(?:node_modules|build|artifacts|test-output|coverage|\.[^/]*cache|\.(?:agents|codex|claude|cursor|idea|vscode|private)|private|internal|notes|plans|prompts|transcripts|conversations|logs|profiles?|captures?|snapshots?)(?:\/|$)|(^|\/)(?:AGENTS(?:\.[^/]+)?|CLAUDE|GEMINI)\.md$|(^|\/)\.env(?:\.|$)|\.(?:pdf|crx|zip|pem|key|p12|pfx|log|jsonl|har|trace|chatlog|sqlite|db|bak)$|(?:conversation|transcript|development-notes|design-decisions)[^/]*\.md$|^docs\/(?:DESIGN|PUBLISHING)\.md$|^docs\/brand\/(?:logo-concept-v1\.md|orderstash-logo-concept-v1\.png)$|^scripts\/brand-assets\.cjs$/i,
};
