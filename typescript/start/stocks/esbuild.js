const fs = require('fs');
const path = require('path');
const { build } = require('esbuild');

// Directory paths
const srcDir = path.join(__dirname, 'src');
const distDir = path.join(__dirname, 'dist');

// Ensure dist directory exists
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

// Copy HTML file
fs.copyFileSync(
  path.join(srcDir, 'index.html'),
  path.join(distDir, 'index.html')
);

// Copy lib directory
const libSrcDir = path.join(srcDir, 'lib');
const libDistDir = path.join(distDir, 'lib');

if (!fs.existsSync(libDistDir)) {
  fs.mkdirSync(libDistDir, { recursive: true });
}

fs.readdirSync(libSrcDir).forEach(file => {
  fs.copyFileSync(
    path.join(libSrcDir, file),
    path.join(libDistDir, file)
  );
});

// Build with esbuild
build({
  entryPoints: [path.join(srcDir, 'index.ts')],
  bundle: true,
  outfile: path.join(distDir, 'index.js'),
  platform: 'browser',
  format: 'iife',
  sourcemap: true,
  target: ['es2020'],
  tsconfig: path.join(__dirname, 'tsconfig.json'),
}).catch((error) => {
  console.error(error);
  process.exit(1);
});