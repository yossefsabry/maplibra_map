const { defineConfig } = require('vite');
const fs = require('node:fs');
const path = require('node:path');

function copyRuntimeAssets() {
  let resolvedConfig;

  return {
    name: 'copy-runtime-assets',
    apply: 'build',
    configResolved(config) {
      resolvedConfig = config;
    },
    closeBundle() {
      const rootDir = resolvedConfig?.root ?? process.cwd();
      const outDir = resolvedConfig?.build?.outDir ?? 'dist';

      const sourceDir = path.resolve(rootDir, 'assets');
      const targetDir = path.resolve(rootDir, outDir, 'assets');

      if (!fs.existsSync(sourceDir)) return;

      fs.mkdirSync(targetDir, { recursive: true });
      fs.cpSync(sourceDir, targetDir, { recursive: true, force: true });
    },
  };
}

module.exports = defineConfig({
  plugins: [copyRuntimeAssets()],
});

