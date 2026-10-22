const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');

// GitHub Pages cannot execute PHP; publishing it can expose server-side source.
function isPHPArtifact(file) {
  const name = path.posix.basename(file.replaceAll('\\', '/')).toLowerCase();
  return /\.(?:php\d*|phtml|pht|phar)$/.test(name)
    || ['composer.json', 'composer.lock', 'php.ini', '.user.ini'].includes(name);
}

test('PHP artifact detection covers runtime and dependency files', () => {
  for (const name of ['index.php', 'INDEX.PHP8', 'shell.phtml', 'index.pht', 'tool.phar',
    'vendor/composer.json', 'composer.lock', 'php.ini', 'config/.user.ini']) {
    assert.equal(isPHPArtifact(name), true, name);
  }
  for (const name of ['index.html', 'home.js', 'styles.css', 'PHP2Shell.md', 'logo.php.png']) {
    assert.equal(isPHPArtifact(name), false, name);
  }
});

test('published static site has no PHP runtime/source or Composer artifacts', () => {
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: path.join(__dirname, '..'), encoding: 'utf8',
  }).split('\0').filter(Boolean);
  assert.ok(files.length > 0);
  assert.deepEqual(files.filter(isPHPArtifact), [], 'PHP requires a separately reviewed and patched hosting design.');
});
