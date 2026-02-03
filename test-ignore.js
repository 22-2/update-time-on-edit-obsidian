const ignore = require('ignore');

const ig = ignore().add(['etc/*', '!etc/journals/']);

const paths = [
  'etc',
  'etc/',
  'etc/journals',
  'etc/journals/',
  'etc/archives',
];

paths.forEach(p => {
  console.log(`'${p}': ${ig.ignores(p)}`);
});

// Check filterIgnoredFolders logic simulation
const folder = 'etc/journals';
const matchPath = folder + '/';
console.log('Checking ' + matchPath + ': ' + ig.ignores(matchPath));

